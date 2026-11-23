"""The real migrations on a throwaway Postgres: they apply cleanly, the public
key can read but never write, and the helper functions give the right numbers.

Needs PG_ADMIN_DSN, a connection string for a superuser on a disposable server
(CI starts one). Skipped otherwise.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg")

REPO = Path(__file__).resolve().parents[1]
ADMIN = os.environ.get("PG_ADMIN_DSN")
DBNAME = "nepse_test"

pytestmark = pytest.mark.skipif(not ADMIN, reason="PG_ADMIN_DSN not set")


@pytest.fixture(scope="module")
def conn():
    with psycopg.connect(ADMIN, autocommit=True) as admin:
        admin.execute(f"drop database if exists {DBNAME} with (force)")
        admin.execute(f"create database {DBNAME}")
        for role in ("anon", "authenticated", "service_role"):
            if not admin.execute("select 1 from pg_roles where rolname = %s", (role,)).fetchone():
                admin.execute(f"create role {role} nologin")
    dsn = psycopg.conninfo.make_conninfo(ADMIN, dbname=DBNAME)
    c = psycopg.connect(dsn, autocommit=True)
    c.execute("grant usage on schema public to anon, authenticated, service_role")
    for migration in sorted((REPO / "supabase/migrations").glob("*.sql")):
        c.execute(migration.read_text())
    yield c
    c.close()


def test_public_key_can_read_but_not_write(conn):
    conn.execute((REPO / "supabase/tests/security_checks.sql").read_text())
    rows = conn.execute("select check_name, passed, detail from check_results").fetchall()
    failed = [r for r in rows if not r[1]]
    assert len(rows) >= 20
    assert failed == []


def test_every_table_has_row_level_security(conn):
    missing = conn.execute("""
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity""").fetchall()
    assert missing == []


def test_adjustments_multiply_through_earlier_prices(conn):
    cid = conn.execute("insert into companies (symbol, name) values ('TESTCO', 'Test') returning id").fetchone()[0]
    days = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]
    for d, close in zip(days, (200, 202, 101, 100)):
        conn.execute("insert into daily_prices (company_id, date, close, source) values (%s, %s, %s, 'test')", (cid, d, close))
    # A 1:1 bonus priced from 7 Jan, and an unconfirmed glitch that must not be applied.
    conn.execute("""insert into price_adjustments (company_id, ex_date, factor, prev_close_reported, prev_close_actual, prev_date, status, source)
                    values (%s, '2026-01-07', 0.5, 101, 202, '2026-01-06', 'confirmed', 'test'),
                           (%s, '2026-01-08', 0.9, 90.9, 101, '2026-01-07', 'unconfirmed', 'test')""", (cid, cid))
    conn.execute("select apply_price_adjustments(%s)", (cid,))
    factors = dict(conn.execute("select date::text, adj_factor from daily_prices where company_id = %s", (cid,)).fetchall())
    assert factors == {"2026-01-05": 0.5, "2026-01-06": 0.5, "2026-01-07": 1.0, "2026-01-08": 1.0}

    closes = conn.execute("select * from latest_closes_before('2026-01-08', '2025-12-01') where company_id = %s", (cid,)).fetchall()
    assert [(str(d), float(c)) for _, d, c in closes] == [("2026-01-07", 101.0)]
    held = [str(r[0]) for r in conn.execute("select * from trading_days('2026-01-06')").fetchall()]
    assert held == ["2026-01-06", "2026-01-07", "2026-01-08"]


def test_feedback_can_be_sent_but_not_read(conn):
    conn.execute("set role anon")
    try:
        conn.execute("insert into feedback (kind, page, message) values ('idea', '/c/AAA', 'Show dividends please')")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select message from feedback")
    finally:
        conn.execute("reset role")
    row = conn.execute("select kind, page, message, name, status, notified_at from feedback order by id desc limit 1").fetchone()
    assert row == ("idea", "/c/AAA", "Show dividends please", "Sanjeev", "new", None)


def test_feedback_cannot_set_its_own_status_or_be_empty(conn):
    conn.execute("set role anon")
    try:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("insert into feedback (kind, message, status) values ('idea', 'hello', 'done')")
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("insert into feedback (kind, message) values ('idea', '  ')")
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("insert into feedback (kind, message) values ('spam', 'hello there')")
    finally:
        conn.execute("reset role")


def test_feedback_flood_is_refused(conn):
    conn.execute("delete from feedback")
    conn.execute("set role anon")
    try:
        for i in range(20):
            conn.execute("insert into feedback (kind, message) values ('other', %s)", (f"message {i}",))
        with pytest.raises(psycopg.errors.RaiseException, match="Too many messages"):
            conn.execute("insert into feedback (kind, message) values ('other', 'one too many')")
    finally:
        conn.execute("reset role")
    conn.execute("delete from feedback")


# ---------------------------------------------------------------- Supabase timer
# Stand-ins for Supabase Vault and pg_net, which a plain Postgres lacks:
# net.http_post records the request instead of sending it.

@pytest.fixture()
def timer_db(conn):
    conn.execute("""
        create schema if not exists vault;
        create table if not exists vault.decrypted_secrets (name text, decrypted_secret text, created_at timestamptz default now());
        create schema if not exists net;
        create table if not exists net.sent (id bigint generated always as identity, url text, body jsonb, headers jsonb);
        create table if not exists net._http_response (id bigint, status_code integer, error_msg text);
        create or replace function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
        returns bigint language sql as $$ insert into net.sent (url, body, headers) values (url, body, headers) returning id $$;
        truncate vault.decrypted_secrets, net.sent, net._http_response, timer.dispatches;
        delete from job_runs where job = 'timer';
    """)
    yield conn


def answer(conn, status: int | None, error: str | None = None):
    """GitHub answers the newest request; it is then over two minutes old."""
    rid = conn.execute("select max(id) from net.sent").fetchone()[0]
    if status is not None or error is not None:
        conn.execute("insert into net._http_response (id, status_code, error_msg) values (%s, %s, %s)", (rid, status, error))
    conn.execute("update timer.dispatches set sent_at = now() - interval '3 minutes'")


def timer_rows(conn):
    return conn.execute("select status, requests, message from job_runs where job = 'timer' order by id").fetchall()


def test_timer_without_a_token_records_a_failure(timer_db):
    assert timer_db.execute("select timer.start('market-eod.yml')").fetchone()[0] is None
    assert timer_db.execute("select count(*) from net.sent").fetchone()[0] == 0
    timer_db.execute("select timer.check()")
    [(status, requests, message)] = timer_rows(timer_db)
    assert (status, requests) == ("failed", 1)
    assert "no GitHub token in Supabase Vault" in message


def test_timer_starts_workflows_and_records_state_changes(timer_db):
    timer_db.execute("insert into vault.decrypted_secrets (name, decrypted_secret) values ('github_actions_token', ' tok123 ')")
    timer_db.execute("select timer.start('market-eod.yml')")
    url, body, headers = timer_db.execute("select url, body, headers from net.sent").fetchone()
    assert url == "https://api.github.com/repos/drabid09/nepse-analyzer/actions/workflows/market-eod.yml/dispatches"
    assert body == {"ref": "main", "inputs": {"timer": "true"}}
    assert headers["Authorization"] == "Bearer tok123"
    assert headers["Accept"] == "application/vnd.github+json"

    # Not answered yet and under two minutes old: not counted yet.
    assert timer_db.execute("select timer.check()").fetchone()[0] == "nothing new to report"

    answer(timer_db, 204)
    timer_db.execute("select timer.check()")
    assert timer_rows(timer_db) == [("ok", 1, "Started 1 GitHub job on time since the last check.")]

    # Still working: the same row is updated, not a new one per hour.
    timer_db.execute("select timer.start('feedback-notify.yml')")
    answer(timer_db, 204)
    timer_db.execute("select timer.start('watchdog.yml')")
    answer(timer_db, 204)
    timer_db.execute("select timer.check()")
    assert timer_rows(timer_db) == [("ok", 3, "Started 2 GitHub jobs on time since the last check.")]

    # The token expires: a new failed row with a plain explanation.
    timer_db.execute("select timer.start('watchdog.yml')")
    answer(timer_db, 401)
    timer_db.execute("select timer.check()")
    rows = timer_rows(timer_db)
    assert [r[0] for r in rows] == ["ok", "failed"]
    assert "probably expired" in rows[-1][2] and "github_actions_token" in rows[-1][2]

    # No answer at all also counts as a failure, and recovery adds an ok row.
    timer_db.execute("select timer.start('watchdog.yml')")
    answer(timer_db, None, "Timeout of 15000 ms reached")
    timer_db.execute("select timer.check()")
    assert "No answer from GitHub: Timeout" in timer_rows(timer_db)[-1][2]
    timer_db.execute("select timer.start('watchdog.yml')")
    answer(timer_db, 204)
    timer_db.execute("select timer.check()")
    assert [r[0] for r in timer_rows(timer_db)] == ["ok", "failed", "ok"]


def test_timer_only_starts_planned_workflows(timer_db):
    with pytest.raises(psycopg.errors.RaiseException, match="not in timer.plan"):
        timer_db.execute("select timer.start('../../evil')")


def test_timer_plan_has_every_workflow_once_per_time(timer_db):
    rows = timer_db.execute("select workflow, count(*) from timer.plan group by workflow order by workflow").fetchall()
    assert dict(rows) == {"analytics-daily.yml": 3, "backtest-weekly.yml": 1, "backup-weekly.yml": 1,
                          "company-details.yml": 1, "feedback-notify.yml": 1, "keepalive.yml": 1,
                          "market-eod.yml": 3, "market-live.yml": 3, "site-monitor.yml": 2,
                          "sync-companies.yml": 1, "watchdog.yml": 2}


def test_forecast_live_record_counts_in_the_database(conn):
    cid = conn.execute("insert into companies (symbol, name) values ('RECCO', 'Record test') returning id").fetchone()[0]
    rows = [("2026-01-05", "1W", 90, 110, 100), ("2026-01-06", "1W", 90, 110, 120), ("2026-01-05", "1M", 80, 120, 100),
            ("2026-01-07", "1W", 90, 110, None)]
    for made_on, horizon, low, high, actual in rows:
        conn.execute("""insert into forecasts (company_id, made_on, horizon, model, target_date, base_close, low, mid, high, band_pct, reliable, actual_close)
                        values (%s, %s, %s, 'ensemble', %s::date + 7, 100, %s, 100, %s, 20, true, %s)""", (cid, made_on, horizon, made_on, low, high, actual))
    conn.execute("set role anon")
    try:
        got = {h: (c, i) for h, c, i in conn.execute("select horizon, checked, inside from forecast_live_record where horizon in ('1W', '1M')").fetchall()}
    finally:
        conn.execute("reset role")
    assert got["1W"] == (2, 1)     # one inside, one outside; the unchecked one is not counted
    assert got["1M"] == (1, 1)
