"""The Supabase timer starts the same workflows at the same times as GitHub's
schedule, every workflow it starts accepts the timer input, and a timer-started
run does not redo finished work."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from common import started_by_hand

REPO = Path(__file__).resolve().parents[1]
WORKFLOWS = REPO / ".github/workflows"
MIGRATION = REPO / "supabase/migrations/20261123000400_timer.sql"
# The Phase 0 probe was a one-off study; the timer does not run it.
NOT_TIMED = {"phase0-source-probe.yml"}


def github_schedule() -> set[tuple[str, str]]:
    pairs = set()
    for path in WORKFLOWS.glob("*.yml"):
        for cron in re.findall(r'^\s*- cron: "([^"]+)"', path.read_text(), re.M):
            pairs.add((path.name, cron))
    return pairs


def timer_plan() -> set[tuple[str, str]]:
    return set(re.findall(r"\('([\w-]+\.yml)',\s*'([^']+)'", MIGRATION.read_text()))


def test_timer_matches_github_schedule():
    expected = {(w, c) for w, c in github_schedule() if w not in NOT_TIMED}
    assert timer_plan() == expected


def test_every_timed_workflow_accepts_the_timer_input():
    for workflow in {w for w, _ in timer_plan()}:
        text = (WORKFLOWS / workflow).read_text()
        assert re.search(r"workflow_dispatch:\n\s+inputs:\n\s+timer:\n(\s+\w+: .+\n)*?\s+type: boolean", text), workflow


@pytest.mark.parametrize("workflow", ["market-eod.yml", "analytics-daily.yml"])
def test_timer_flag_reaches_the_jobs_that_skip_finished_work(workflow):
    assert "RUN_BY_TIMER: ${{ inputs.timer && '1' || '' }}" in (WORKFLOWS / workflow).read_text()


@pytest.mark.parametrize("event, timer, by_hand", [
    ("workflow_dispatch", "", True),     # the Run workflow button: redo
    ("push", "", True),
    ("workflow_dispatch", "1", False),   # the Supabase timer: behave like a schedule
    ("schedule", "", False),
    ("workflow_run", "", False),
    (None, "", False),                   # a local run
])
def test_started_by_hand(monkeypatch, event, timer, by_hand):
    if event:
        monkeypatch.setenv("GITHUB_EVENT_NAME", event)
    else:
        monkeypatch.delenv("GITHUB_EVENT_NAME", raising=False)
    monkeypatch.setenv("RUN_BY_TIMER", timer)
    assert started_by_hand() is by_hand


def test_watchdog_reads_the_timer():
    from datetime import datetime, timedelta, timezone

    from watchdog import timer_state

    now = datetime(2026, 11, 24, 6, 0, tzinfo=timezone.utc)
    row = lambda status, hours, message="": {"status": status, "message": message,  # noqa: E731
                                             "heartbeat_at": (now - timedelta(hours=hours)).isoformat()}
    assert timer_state(None, now) is None                       # not set up yet: no check
    assert timer_state(row("ok", 1), now)[0] is True
    ok, _, bad = timer_state(row("failed", 0, "1 of 1 starts failed. GitHub refused the token (HTTP 401)"), now)
    assert not ok and "HTTP 401" in bad
    ok, _, bad = timer_state(row("ok", 5), now)
    assert not ok and "5 hours" in bad
