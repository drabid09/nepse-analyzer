#!/usr/bin/env python3
"""Site monitor: does the live website show what the database holds?

The watchdog checks the jobs and the database. This checks the last step, the
website itself, the way a visitor sees it:

  * every page loads (HTTP 200) and shows data, not an error or setup notice,
    and the feedback form is there;
  * the latest final trading day on Data health is the database's;
  * the NEPSE index on the Market page is the database's latest value;
  * the number of companies on Signals is the number of signals stored;
  * prices for a sample of companies on Signals, and on one company page,
    are the database's latest prices;
  * no secret key appears anywhere in the pages, and the security headers are set.

Pages may be up to a minute behind the database (they are cached for 60 s), so a
mismatch is retried twice, 75 s apart, before it counts. A failure fails the
workflow, which makes GitHub email the repository owner.

After a change to the website, EXPECT_COMMIT holds the commit just pushed: the
monitor first waits for production to serve it (the page's x-commit meta tag),
which also catches a deployment that failed to build.
"""

from __future__ import annotations

import os
import re
import sys
import time as clock
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "ingest"))
from common import JobError, Supabase, now_npt, write_summary  # noqa: E402

SITE = os.environ.get("SITE_URL", "https://nepse-analyzer-peach.vercel.app").rstrip("/")
NEPSE_INDEX_ID = 58
ATTEMPTS = 3
WAIT = 75  # seconds between attempts
SAMPLE = 6
DEPLOY_TIMEOUT = 15 * 60  # seconds to wait for a new deployment
DEPLOY_POLL = 20
ERROR_MARKERS = ("Data temporarily unavailable", "Something went wrong", "Almost ready")
HEADERS = {"x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin"}


# ---------------------------------------------------------------- formatting, as the website does it

def indian(value: float, digits: int = 2) -> str:
    """12561.1 -> '12,561.10'; 1234567 -> '12,34,567.00' (lakh grouping, like en-IN)."""
    text = f"{abs(value):.{digits}f}"
    whole, _, frac = text.partition(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return ("-" if value < 0 else "") + whole + (f".{frac}" if frac else "")


def nepali_days(d: date) -> set[str]:
    """'Fri, 20 Nov 2026' as the site writes it (en-GB). Newer browsers write September as 'Sept'."""
    base = f"{d:%a}, {d.day} {d:%b} {d.year}"
    return {base, base.replace(" Sep ", " Sept ")}


# ---------------------------------------------------------------- pages

class _Text(HTMLParser):
    """Visible text only (no scripts), plus the text of each table row."""

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.rows: list[str] = []
        self._row: list[str] | None = None
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "template"):
            self._skip += 1
        elif tag == "tr":
            self._row = []

    def handle_endtag(self, tag):
        if tag in ("script", "style", "template"):
            self._skip = max(0, self._skip - 1)
        elif tag == "tr" and self._row is not None:
            self.rows.append(" ".join(" ".join(self._row).split()))
            self._row = None

    def handle_data(self, data):
        if self._skip:
            return
        self.parts.append(data)
        if self._row is not None:
            self._row.append(data)


class Page:
    def __init__(self, client: httpx.Client, path: str):
        self.path = path
        try:
            r = client.get(SITE + path)
            self.status, self.html, self.headers = r.status_code, r.text, r.headers
        except httpx.HTTPError as exc:
            self.status, self.html, self.headers = 0, "", {}
            self.error = type(exc).__name__
        parser = _Text()
        parser.feed(self.html)
        self.text = " ".join(" ".join(parser.parts).split())
        self.rows = parser.rows


def served_commit(client: httpx.Client) -> str | None:
    try:
        html = client.get(SITE + "/").text
    except httpx.HTTPError:
        return None
    match = re.search(r'<meta name="x-commit" content="([^"]+)"', html)
    return match.group(1) if match else None


def wait_for_commit(client: httpx.Client, sha: str, timeout: float = DEPLOY_TIMEOUT, poll: float = DEPLOY_POLL) -> tuple[bool, str | None]:
    """Wait until production serves the given commit. Returns (served, last commit seen)."""
    deadline = clock.monotonic() + timeout
    seen = served_commit(client)
    while seen != sha and clock.monotonic() < deadline:
        clock.sleep(poll)
        seen = served_commit(client)
    return seen == sha, seen


# ---------------------------------------------------------------- the database's view

def expected(db: Supabase) -> dict:
    final = db.select("market_daily", select="date", is_final="eq.true", order="date.desc", limit=1)
    sig_day = db.select("signals", select="date", order="date.desc", limit=1)
    price_day = db.select("daily_prices", select="date", order="date.desc", limit=1)
    index = db.select("index_daily", select="date,close", index_id=f"eq.{NEPSE_INDEX_ID}", order="date.desc", limit=1)
    if not (final and sig_day and price_day and index):
        raise JobError("the database has no final day, signals, prices or NEPSE index yet")
    signals = db.select_all("signals", select="company_id", date=f"eq.{sig_day[0]['date']}")
    prices = db.select_all("daily_prices", select="company_id,close", date=f"eq.{price_day[0]['date']}")
    symbols = {c["id"]: c["symbol"] for c in db.select_all("companies", select="id,symbol")}
    with_signal = {s["company_id"] for s in signals}
    priced = sorted((symbols[p["company_id"]], float(p["close"])) for p in prices
                    if p["company_id"] in with_signal and p["company_id"] in symbols)
    step = max(1, len(priced) // SAMPLE)
    return {
        "final_day": date.fromisoformat(final[0]["date"]),
        "index_day": date.fromisoformat(index[0]["date"]),
        "index_close": float(index[0]["close"]),
        "signal_count": len(signals),
        "sample": priced[::step][:SAMPLE],
    }


# ---------------------------------------------------------------- checks

def check(db: Supabase, client: httpx.Client) -> tuple[list[str], list[str], dict]:
    exp = expected(db)
    sample = exp["sample"]
    pages = {p: Page(client, p) for p in ("/", "/signals", "/track-record", "/health", "/guide", "/feedback", f"/c/{sample[0][0]}")}
    problems: list[str] = []
    notes: list[str] = []
    secret = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()

    for path, page in pages.items():
        if page.status != 200:
            problems.append(f"{path}: HTTP {page.status or getattr(page, 'error', 'no response')}")
            continue
        for marker in ERROR_MARKERS:
            if marker in page.text:
                problems.append(f"{path}: shows '{marker}'")
        if "sb_secret_" in page.html or (secret and secret in page.html):
            problems.append(f"{path}: a secret key appears in the page")
        for name, value in HEADERS.items():
            if page.headers.get(name) != value:
                problems.append(f"{path}: header {name} is {page.headers.get(name)!r}, expected {value!r}")

    health, market, signals = pages["/health"], pages["/"], pages["/signals"]
    if not any(f"Latest final trading day: {d}" in health.text for d in nepali_days(exp["final_day"])):
        problems.append(f"Data health does not show {exp['final_day']} as the latest final trading day")
    if not any(f"NEPSE Index · {d}" in market.text for d in nepali_days(exp["index_day"])):
        problems.append(f"Market page does not show the NEPSE index for {exp['index_day']}")
    if indian(exp["index_close"]) not in market.text:
        problems.append(f"Market page does not show the NEPSE index value {indian(exp['index_close'])}")
    if f"all {exp['signal_count']}" not in signals.text.lower():  # the page capitalises "all" with CSS
        problems.append(f"Signals page does not list {exp['signal_count']} companies")

    if pages["/feedback"].status == 200 and "Your message" not in pages["/feedback"].text:
        problems.append("/feedback: the feedback form is missing")

    rows = {r.split(" ", 1)[0]: r for r in signals.rows if r}
    for symbol, close in sample:
        row = rows.get(symbol)
        if row is None:
            problems.append(f"Signals page has no row for {symbol}")
        elif indian(close) not in row:
            problems.append(f"Signals page shows {symbol} without the database price {indian(close)}")
    symbol, close = sample[0]
    if indian(close) not in pages[f"/c/{symbol}"].text:
        problems.append(f"/c/{symbol} does not show the database price {indian(close)}")

    # Banners are the site's own warnings (late live prices, a failed data check).
    # The watchdog acts on their causes; here they are only reported.
    for text in ("Live prices are delayed", "Live prices have not started", "not final yet", "Data check failed"):
        if text in market.text:
            notes.append(f"the site is showing a warning: '{text}…'")
    return problems, notes, exp


def main() -> None:
    db = Supabase()
    expect = os.environ.get("EXPECT_COMMIT", "").strip()
    with httpx.Client(timeout=30, follow_redirects=True, headers={"User-Agent": "nepse-analyzer site monitor"}) as client:
        if expect:
            served, seen = wait_for_commit(client, expect)
            if not served:
                raise JobError(f"production still serves commit {seen or 'unknown'} {DEPLOY_TIMEOUT // 60} minutes after {expect[:7]} "
                               "was pushed: the Vercel deployment may have failed. Check the project's Deployments page.")
            print(f"production serves {expect[:7]}")
        for attempt in range(1, ATTEMPTS + 1):
            problems, notes, exp = check(db, client)
            if not problems or attempt == ATTEMPTS:
                break
            print(f"attempt {attempt}: {len(problems)} problem(s), retrying in {WAIT} s: {problems[:3]}")
            clock.sleep(WAIT)

    lines = [f"## Site monitor: {SITE}", f"Checked at {now_npt():%Y-%m-%d %H:%M} Nepal time, attempt {attempt} of {ATTEMPTS}.", "",
             f"- Latest final trading day: {exp['final_day']}",
             f"- NEPSE index {indian(exp['index_close'])} ({exp['index_day']})",
             f"- Companies with signals: {exp['signal_count']}",
             f"- Prices compared: {', '.join(f'{s} {indian(c)}' for s, c in exp['sample'])}", ""]
    lines += [f"- Note: {n}" for n in notes]
    lines += ["", "**All checks passed.**"] if not problems else ["", "**Problems:**", *[f"- {p}" for p in problems]]
    write_summary("\n".join(lines))
    if problems:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except JobError as exc:
        write_summary(f"## Site monitor\n\nCould not run: {exc}")
        sys.exit(1)
