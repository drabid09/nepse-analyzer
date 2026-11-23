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
