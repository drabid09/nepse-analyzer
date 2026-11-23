"""The site monitor must notice when the website shows something other than
what the database holds."""

from __future__ import annotations

from datetime import date

import httpx
import pytest

import site_monitor as sm
from conftest import FakeDB

DAY = "2026-11-20"
SAFE_HEADERS = {"x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin"}


def test_lakh_grouping_matches_the_website():
    assert sm.indian(12561.1) == "12,561.10"
    assert sm.indian(2622.07) == "2,622.07"
    assert sm.indian(1234567.5) == "12,34,567.50"
    assert sm.indian(999.0) == "999.00"
    assert sm.indian(-4.55) == "-4.55"


def test_dates_as_the_website_writes_them():
    assert "Fri, 20 Nov 2026" in sm.nepali_days(date(2026, 11, 20))
    assert "Tue, 15 Sept 2026" in sm.nepali_days(date(2026, 9, 15))


def db(close_aaa=1234.5):
    return FakeDB(tables={
        "market_daily": [{"date": DAY, "is_final": True}],
        "signals": [{"date": DAY, "company_id": i} for i in (1, 2, 3)],
        "daily_prices": [{"date": DAY, "company_id": 1, "close": close_aaa}, {"date": DAY, "company_id": 2, "close": 99.9},
                         {"date": DAY, "company_id": 3, "close": 15000.0}],
        "index_daily": [{"date": DAY, "index_id": 58, "close": 2622.07}],
        "companies": [{"id": 1, "symbol": "AAA"}, {"id": 2, "symbol": "BBB"}, {"id": 3, "symbol": "CCC"}],
    })


def site(overrides: dict | None = None, headers: dict | None = None):
    pages = {
        "/": "<div>NEPSE Index · Fri, 20 Nov 2026 · live</div><div>2,622.07</div>",
        "/signals": "<button>all 3</button><table><tr><th>Company</th></tr>"
                    "<tr><td><a>AAA</a><div>A Ltd</div></td><td>1,234.50</td></tr>"
                    "<tr><td>BBB</td><td>99.90</td></tr><tr><td>CCC</td><td>15,000.00</td></tr></table>",
        "/track-record": "<h1>Track record</h1>",
        "/health": "<p>Latest final trading day: <span>Fri, 20 Nov 2026</span></p>",
        "/guide": "<h1>How to read your dashboard</h1>",
        "/feedback": "<form><label>Your message</label><textarea></textarea></form>",
        "/c/AAA": "<h1>AAA</h1><div>1,234.50</div><script>self.__next_f.push('not visible')</script>",
    }
    pages.update(overrides or {})

    def handler(request: httpx.Request) -> httpx.Response:
        body = pages.get(request.url.path)
        if body is None:
            return httpx.Response(404, text="not found")
        return httpx.Response(200, text=body, headers=headers if headers is not None else SAFE_HEADERS)

    return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://test")


@pytest.fixture(autouse=True)
def local_site(monkeypatch):
    monkeypatch.setattr(sm, "SITE", "http://test")


def test_a_site_matching_the_database_passes():
    problems, notes, exp = sm.check(db(), site())
    assert problems == []
    assert exp["signal_count"] == 3


def test_a_wrong_price_is_caught():
    problems, _, _ = sm.check(db(close_aaa=1240.0), site())
    assert any("AAA" in p and "1,240.00" in p for p in problems)


def test_an_error_page_is_caught():
    problems, _, _ = sm.check(db(), site({"/": "<h2>Data temporarily unavailable</h2>"}))
    assert any("Data temporarily unavailable" in p for p in problems)


def test_a_stale_final_day_is_caught():
    problems, _, _ = sm.check(db(), site({"/health": "<p>Latest final trading day: Thu, 19 Nov 2026</p>"}))
    assert any("latest final trading day" in p for p in problems)


def test_a_leaked_secret_key_is_caught():
    problems, _, _ = sm.check(db(), site({"/track-record": "<script>const k='sb_secret_abc'</script>"}))
    assert any("secret key" in p for p in problems)


def test_missing_security_headers_are_caught():
    problems, _, _ = sm.check(db(), site(headers={}))
    assert any("x-frame-options" in p for p in problems)


def test_a_page_that_is_down_is_caught():
    problems, _, _ = sm.check(db(), site({"/signals": None}))
    assert any(p.startswith("/signals: HTTP 404") for p in problems)


def test_waits_for_the_new_deployment(monkeypatch):
    served = iter(["old", "old", "new"])
    monkeypatch.setattr(sm.clock, "sleep", lambda s: None)
    monkeypatch.setattr(sm, "served_commit", lambda client: next(served))
    assert sm.wait_for_commit(None, "new", timeout=60, poll=1) == (True, "new")


def test_reads_the_commit_from_the_page():
    page = '<head><meta name="x-commit" content="abc123"/></head>'
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=page)), base_url="http://test")
    assert sm.served_commit(client) == "abc123"


def test_gives_up_when_the_deployment_never_arrives(monkeypatch):
    monkeypatch.setattr(sm, "served_commit", lambda client: "old")
    assert sm.wait_for_commit(None, "new", timeout=0, poll=1) == (False, "old")


def test_a_missing_feedback_form_is_caught():
    problems, _, _ = sm.check(db(), site({"/feedback": "<h1>Tell Drabid</h1>"}))
    assert "/feedback: the feedback form is missing" in problems

