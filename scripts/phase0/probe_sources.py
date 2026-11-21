#!/usr/bin/env python3
"""Phase 0 - NEPSE data source probe.

Runs on a GitHub Actions runner (outside Nepal) and records, for every candidate
source, what actually happens: reachable or not, TLS health, auth needs, live
prices, history depth, rate-limit behaviour and signs of geo/IP blocking.

Rules this script follows:
  * It never invents data. Every value in the report was returned by the source
    during this run, or is an error message.
  * It is polite: one pass, a pause between requests to the same host, and a hard
    cap on requests per source.
  * It always exits 0 so the report is still written when a source fails. A
    failing source is a finding, not a crash.

Output: reports/phase0/latest.json, reports/phase0/latest.md and one line
appended to reports/phase0/history.csv.
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import signal
import socket
import ssl
import sys
import time
import traceback
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx

REPORT_DIR = Path(__file__).resolve().parents[2] / "reports" / "phase0"
NPT_OFFSET_MIN = 345  # Nepal time is UTC+05:45, no daylight saving

# Honest identification first. If a site rejects it we retry ONCE with a browser
# string and record that a browser disguise was needed (that is itself a finding).
HONEST_UA = "nepse-analyzer-phase0-probe/0.1 (+https://github.com/drabid09/nepse-analyzer)"
BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0 Safari/537.36"
)

PAUSE_SECONDS = 1.5  # gap between requests to the same host
CALL_TIMEOUT = 75  # hard wall-clock limit for any single library call
SAMPLE_SYMBOLS = ["NABIL", "ACLBSL"]  # one old large-cap, one newer microfinance

RATE_HEADERS = (
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "ratelimit-limit",
    "ratelimit-remaining",
)
BLOCK_MARKERS = (
    "just a moment",
    "attention required",
    "cf-chl",
    "captcha",
    "access denied",
    "request blocked",
    "unusual traffic",
)


# --------------------------------------------------------------------------- helpers


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def npt_string(dt: datetime) -> str:
    """UTC datetime -> 'YYYY-MM-DD HH:MM NPT (Weekday)'."""
    shifted = datetime.fromtimestamp(dt.timestamp() + NPT_OFFSET_MIN * 60, timezone.utc)
    return shifted.strftime("%Y-%m-%d %H:%M NPT (%A)")


def short(obj, limit: int = 700) -> str:
    text = obj if isinstance(obj, str) else json.dumps(obj, default=str, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit] + " ...[truncated]"


class CallTimeout(Exception):
    pass


def _alarm_handler(signum, frame):
    raise CallTimeout(f"no answer within {CALL_TIMEOUT}s")


def timed(fn, *args, **kwargs) -> dict:
    """Run fn with a hard timeout. Returns {ok, seconds, value | error}."""
    started = time.monotonic()
    signal.signal(signal.SIGALRM, _alarm_handler)
    signal.alarm(CALL_TIMEOUT)
    try:
        value = fn(*args, **kwargs)
        return {"ok": True, "seconds": round(time.monotonic() - started, 2), "value": value}
    except BaseException as exc:  # noqa: BLE001 - we want every failure in the report
        if isinstance(exc, KeyboardInterrupt):
            raise
        return {
            "ok": False,
            "seconds": round(time.monotonic() - started, 2),
            "error": f"{type(exc).__name__}: {short(str(exc), 300)}",
        }
    finally:
        signal.alarm(0)


def describe(value) -> dict:
    """Shape of a JSON answer: type, size, field names and one small sample."""
    info: dict = {"type": type(value).__name__}
    if isinstance(value, list):
        info["count"] = len(value)
        if value and isinstance(value[0], dict):
            info["fields"] = sorted(value[0].keys())
        if value:
            info["sample"] = short(value[0])
    elif isinstance(value, dict):
        info["fields"] = sorted(value.keys())
        info["sample"] = short(value)
    else:
        info["sample"] = short(value)
    return info


def date_range(rows) -> dict | None:
    """Earliest and latest value of the first date-like field in a list of rows."""
    if not (isinstance(rows, list) and rows and isinstance(rows[0], dict)):
        return None
    key = next((k for k in rows[0] if "date" in k.lower()), None)
    if key is None:
        return None
    values = sorted(str(r[key])[:10] for r in rows if r.get(key))
    if not values:
        return None
    return {"field": key, "earliest": values[0], "latest": values[-1], "rows": len(values)}


def find_symbol(rows, symbol: str):
    if not isinstance(rows, list):
        return None
    for row in rows:
        if isinstance(row, dict) and str(row.get("symbol", "")).upper() == symbol:
            return row
    return None


# --------------------------------------------------------------------------- TLS


def tls_check(host: str) -> dict:
    """Handshake with normal certificate verification, then report what failed.

    NEPSE's site has a history of serving an incomplete certificate chain, which
    makes strict clients refuse it. We need to know whether that is still true
    before deciding how the fetch jobs connect.
    """
    result: dict = {"host": host}
    try:
        result["resolved_ips"] = sorted({i[4][0] for i in socket.getaddrinfo(host, 443)})
    except OSError as exc:
        result.update(verified=False, error=f"DNS failure: {exc}")
        return result
    try:
        context = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=20) as raw:
            with context.wrap_socket(raw, server_hostname=host) as tls:
                cert = tls.getpeercert()
                result.update(
                    verified=True,
                    protocol=tls.version(),
                    issuer=" / ".join(v for part in cert.get("issuer", ()) for _, v in part),
                    expires=cert.get("notAfter"),
                )
    except ssl.SSLCertVerificationError as exc:
        result.update(verified=False, error=f"certificate verification failed: {exc.verify_message}")
    except (OSError, ssl.SSLError) as exc:
        result.update(verified=False, error=f"{type(exc).__name__}: {exc}")
    return result


# --------------------------------------------------------------------------- plain HTTP


def http_get(url: str, *, ua: str = HONEST_UA, verify: bool = True, extra_headers=None) -> dict:
    """One GET. Returns facts about the answer plus the body under '_body'."""
    headers = {"User-Agent": ua, "Accept": "*/*", "Accept-Language": "en"}
    headers.update(extra_headers or {})
    out: dict = {"url": url, "user_agent": "honest" if ua == HONEST_UA else "browser"}
    started = time.monotonic()
    try:
        with httpx.Client(verify=verify, follow_redirects=True, timeout=30, headers=headers) as client:
            response = client.get(url)
        body = response.text
        lowered = body[:20000].lower()
        out.update(
            reachable=True,
            status=response.status_code,
            seconds=round(time.monotonic() - started, 2),
            final_url=str(response.url),
            bytes=len(response.content),
            content_type=response.headers.get("content-type"),
            server=response.headers.get("server"),
            last_modified=response.headers.get("last-modified"),
            rate_headers={h: response.headers[h] for h in RATE_HEADERS if h in response.headers},
            block_signals=sorted(m for m in BLOCK_MARKERS if m in lowered)
            + (["cf-mitigated header"] if "cf-mitigated" in response.headers else []),
            _body=body,
        )
    except Exception as exc:  # noqa: BLE001
        out.update(
            reachable=False,
            seconds=round(time.monotonic() - started, 2),
            error=f"{type(exc).__name__}: {short(str(exc), 300)}",
            _body="",
        )
    time.sleep(PAUSE_SECONDS)
    return out


def get_with_fallback(url: str, **kwargs) -> dict:
    """Honest user agent first; one browser-UA retry if the site refuses it."""
    first = http_get(url, **kwargs)
    refused = (not first["reachable"]) or first.get("status") in (401, 403, 406, 429, 503)
    if not refused:
        return first
    second = http_get(url, ua=BROWSER_UA, **kwargs)
    second["honest_ua_attempt"] = {k: v for k, v in first.items() if k != "_body"}
    second["needed_browser_ua"] = bool(second["reachable"] and second.get("status") == 200)
    return second


def strip_body(result: dict) -> dict:
    return {k: v for k, v in result.items() if k != "_body"}


def context_around(body: str, needle: str, width: int = 90) -> str | None:
    """Visible text around the first occurrence of needle (tags removed)."""
    text = re.sub(r"<(script|style)\b.*?</\1>", " ", body, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    idx = text.lower().find(needle.lower())
    if idx < 0:
        return None
    return text[max(0, idx - 20) : idx + width].strip()


def table_row(body: str, symbol: str) -> list[str] | None:
    """Cells of the first table row that contains the symbol."""
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body, flags=re.S | re.I):
        cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, flags=re.S | re.I)]
        if symbol in cells:
            return cells[:12]
    return None


# --------------------------------------------------------------------------- source: nepalstock.com


class RequestBudget:
    """Stops the unofficial library from retrying forever.

    The library retries transport errors and expired tokens by calling itself
    again with no limit. Against a blocked or broken server that would mean
    hundreds of requests, so every request goes through this counter and a call
    that exceeds its budget is aborted with an error the library does not catch.
    """

    class Exhausted(RuntimeError):
        pass

    def __init__(self, client, per_call: int = 12, max_transport_errors: int = 3):
        self.per_call = per_call
        self.max_transport_errors = max_transport_errors
        self.total = 0
        self.statuses: dict[str, int] = {}
        self.reset()
        self._wrap(client, "get")
        self._wrap(client, "post")

    def reset(self):
        self.in_call = 0
        self.transport_errors = 0

    def _wrap(self, client, method: str):
        original = getattr(client, method)

        def guarded(*args, **kwargs):
            self.in_call += 1
            self.total += 1
            if self.in_call > self.per_call:
                raise self.Exhausted(f"more than {self.per_call} requests needed for one call")
            try:
                response = original(*args, **kwargs)
            except httpx.TransportError as exc:
                self.transport_errors += 1
                if self.transport_errors >= self.max_transport_errors:
                    raise self.Exhausted(f"{self.transport_errors} transport errors in a row: {type(exc).__name__}: {exc}") from exc
                raise
            key = str(response.status_code)
            self.statuses[key] = self.statuses.get(key, 0) + 1
            return response

        setattr(client, method, guarded)


def probe_nepalstock() -> dict:
    """NEPSE's own website API, reached through the open-source `nepse` library.

    The endpoint paths come from that library's API_ENDPOINTS.json; none are
    guessed here. The library works out the short-lived access token that the
    site's own JavaScript normally computes.
    """
    host = "www.nepalstock.com"
    base = f"https://{host}"
    out: dict = {"source": "nepalstock.com (NEPSE website API via unofficial `nepse` library)"}

    out["tls"] = tls_check(host)
    out["tls_alt_domain"] = tls_check("nepalstock.com.np")
    verify = bool(out["tls"].get("verified"))

    out["homepage"] = strip_body(get_with_fallback(base + "/", verify=verify))
    robots = get_with_fallback(base + "/robots.txt", verify=verify)
    out["robots"] = strip_body(robots)
    # The site is a single-page app and may answer every unknown path with its
    # HTML shell, so only treat this as robots rules if it looks like a rules file.
    out["robots"]["looks_like_robots_file"] = "user-agent" in robots["_body"].lower()[:2000]
    out["robots"]["text"] = robots["_body"][:1500] if out["robots"]["looks_like_robots_file"] else None

    # Does the data API answer without a token? (Tells us whether auth is required.)
    no_token = http_get(base + "/api/nots/nepse-data/market-open", ua=BROWSER_UA, verify=verify)
    out["without_token"] = strip_body(no_token)
    out["without_token"]["body_start"] = short(no_token["_body"], 200)

    if not out["homepage"].get("reachable"):
        out["library"] = {"skipped": "site not reachable from this runner, library calls not attempted"}
        return out

    try:
        from nepse import Nepse
    except Exception as exc:  # noqa: BLE001
        out["library"] = {"skipped": f"could not import nepse library: {exc}"}
        return out

    lib: dict = {"tls_verification_used": verify, "calls": {}}
    out["library"] = lib
    api = Nepse()
    api.setTLSVerification(verify)  # rebuilds the HTTP client, so wrap it afterwards
    budget = RequestBudget(api.client)

    def call(name: str, fn, *args, keep=None, **kwargs):
        budget.reset()
        result = timed(fn, *args, **kwargs)
        entry = {"ok": result["ok"], "seconds": result["seconds"], "requests": budget.in_call}
        if result["ok"]:
            entry.update(describe(result["value"]))
            if keep:
                entry.update(keep(result["value"]) or {})
        else:
            entry["error"] = result["error"]
        lib["calls"][name] = entry
        time.sleep(PAUSE_SECONDS)
        return result.get("value") if result["ok"] else None

    status = call("market_status", api.getMarketStatus)
    if status is None:
        lib["aborted"] = "first authenticated call failed, remaining calls not attempted"
        lib["request_total"] = budget.total
        lib["http_statuses"] = budget.statuses
        return out

    call("nepse_index", api.getNepseIndex)
    call("sub_indices", api.getNepseSubIndices)
    call("market_summary", api.getSummary)
    call("company_list", api.getCompanyList, keep=lambda v: {
        "sectors": sorted({str(c.get("sectorName")) for c in v if isinstance(c, dict)}),
    })
    call("security_list", api.getSecurityList)
    call("price_volume_today", api.getPriceVolume, keep=lambda v: {
        "sample_rows": {s: short(find_symbol(v, s), 500) for s in SAMPLE_SYMBOLS},
    })
    call("live_market", api.getLiveMarket, keep=lambda v: {
        "sample_rows": {s: short(find_symbol(v, s), 500) for s in SAMPLE_SYMBOLS},
    })
    call("top_gainers", api.getTopGainers)
    call("index_intraday_graph", api.getDailyNepseIndexGraph, keep=lambda v: {
        "first_point": short(v[0], 120) if isinstance(v, list) and v else None,
        "last_point": short(v[-1], 120) if isinstance(v, list) and v else None,
    })

    # History depth: ask for everything since 2000 and see how far back it goes.
    endpoints = api.api_end_points
    for symbol in SAMPLE_SYMBOLS:
        def history_facts(value):
            rows = value.get("content") if isinstance(value, dict) else value
            facts = {"date_range_first_page": date_range(rows)}
            if isinstance(value, dict):
                facts["paging"] = {k: value.get(k) for k in ("totalElements", "totalPages", "size", "number", "last") if k in value}
            return facts

        first_page = call(
            f"history_{symbol}", api.getCompanyPriceVolumeHistory, symbol,
            start_date=date(2000, 1, 1), end_date=date.today(), keep=history_facts,
        )
        # If the answer is paged, fetch the last page too so we see the true oldest row.
        pages = first_page.get("totalPages") if isinstance(first_page, dict) else None
        if isinstance(pages, int) and pages > 1:
            def last_page(symbol=symbol, pages=pages):
                security_id = api.getSecurityIDKeyMap()[symbol]
                return api.requestGETAPI(
                    f"{endpoints['company_price_volume_history']}{security_id}"
                    f"?&size=500&startDate=2000-01-01&endDate={date.today()}&page={pages - 1}"
                )

            call(f"history_{symbol}_last_page", last_page, keep=history_facts)

    call("intraday_ticks_NABIL", api.getDailyScripPriceGraph, "NABIL")
    call("company_details_NABIL", api.getCompanyDetails, "NABIL")
    call(
        "floorsheet_first_page", api.requestPOSTAPI,
        url=f"{endpoints['floor_sheet']}?&size=20&sort=contractId,desc",
        payload_generator=api.getPOSTPayloadIDForFloorSheet,
        keep=lambda v: {
            "paging": {k: v["floorsheets"].get(k) for k in ("totalElements", "totalPages")}
        } if isinstance(v, dict) and isinstance(v.get("floorsheets"), dict) else None,
    )

    # Small burst: ten quick calls in a row. Enough to see throttling, small
    # enough to be harmless. Our real schedule is far slower than this.
    burst = []
    for _ in range(10):
        budget.reset()
        result = timed(api.getMarketStatus)
        burst.append({"ok": result["ok"], "seconds": result["seconds"], **({"error": result["error"]} if not result["ok"] else {})})
        time.sleep(0.3)
    lib["burst_10_calls"] = {
        "succeeded": sum(1 for b in burst if b["ok"]),
        "slowest_seconds": max(b["seconds"] for b in burst),
        "errors": [b["error"] for b in burst if not b["ok"]][:3],
    }

    lib["request_total"] = budget.total
    lib["http_statuses"] = budget.statuses
    return out


# --------------------------------------------------------------------------- source: open history dataset


def probe_github_dataset() -> dict:
    """Aabishkar2/nepse-data: MIT-licensed per-company daily CSVs kept on GitHub.

    Its own scraper reads Sharesansar, so this is Sharesansar data one step
    removed. Useful as a one-time history backfill that needs no scraping by us.
    """
    repo = "Aabishkar2/nepse-data"
    out: dict = {"source": f"github.com/{repo} (daily CSV per company)", "files": {}}
    for symbol in SAMPLE_SYMBOLS:
        got = http_get(f"https://raw.githubusercontent.com/{repo}/main/data/company-wise/{symbol}.csv")
        entry = strip_body(got)
        if got.get("status") == 200:
            rows = list(csv.DictReader(io.StringIO(got["_body"])))
            entry.update(
                columns=list(rows[0].keys()) if rows else [],
                rows=len(rows),
                first_row=rows[0] if rows else None,
                last_row=rows[-1] if rows else None,
            )
        out["files"][symbol] = entry

    headers = {"Accept": "application/vnd.github+json"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    commits = http_get(f"https://api.github.com/repos/{repo}/commits?per_page=1", extra_headers=headers)
    out["last_commit"] = strip_body(commits)
    try:
        out["last_commit"]["date"] = json.loads(commits["_body"])[0]["commit"]["committer"]["date"]
    except Exception:  # noqa: BLE001
        out["last_commit"]["date"] = None
    return out


# --------------------------------------------------------------------------- source: public sites


def probe_sharesansar() -> dict:
    base = "https://www.sharesansar.com"
    out: dict = {"source": "sharesansar.com (public HTML pages)", "tls": tls_check("www.sharesansar.com")}
    robots = get_with_fallback(base + "/robots.txt")
    out["robots"] = strip_body(robots)
    out["robots"]["text"] = robots["_body"][:1500]

    page = get_with_fallback(base + "/today-share-price")
    entry = strip_body(page)
    body = page["_body"]
    entry.update(
        table_rows=len(re.findall(r"<tr", body, flags=re.I)),
        as_of_text=context_around(body, "as of"),
        sample_rows={s: table_row(body, s) for s in SAMPLE_SYMBOLS},
        # Discovery only: which form targets and ajax URLs the page itself refers to.
        form_actions=sorted(set(re.findall(r'<form[^>]+action="([^"]+)"', body, flags=re.I)))[:10],
        ajax_urls=sorted(set(re.findall(r'https?://www\.sharesansar\.com/[a-z0-9/_-]*ajax[a-z0-9/_-]*', body, flags=re.I)))[:15],
    )
    out["today_share_price"] = entry
    return out


def probe_merolagani() -> dict:
    """Reachability only. Merolagani's terms forbid automated collection, so this
    source is not a candidate for ingestion; we only record whether it answers."""
    base = "https://merolagani.com"
    out: dict = {
        "source": "merolagani.com (public HTML pages)",
        "policy_note": "Terms of use prohibit scripts, scraping and data mining. Reachability check only; not to be used for ingestion.",
        "tls": tls_check("merolagani.com"),
    }
    robots = get_with_fallback(base + "/robots.txt")
    out["robots"] = strip_body(robots)
    # A 200 answer is not proof of a rules file; the site may serve an HTML page instead.
    out["robots"]["looks_like_robots_file"] = "user-agent" in robots["_body"].lower()[:2000]
    page = get_with_fallback(base + "/LatestMarket.aspx")
    entry = strip_body(page)
    entry.update(
        table_rows=len(re.findall(r"<tr", page["_body"], flags=re.I)),
        as_of_text=context_around(page["_body"], "as of"),
    )
    out["latest_market"] = entry
    return out


def probe_nepsealpha() -> dict:
    """Reachability only. robots.txt disallows /api/* and /trading/*, which is
    where its data lives, so this source is not a candidate for ingestion."""
    base = "https://nepsealpha.com"
    out: dict = {
        "source": "nepsealpha.com",
        "policy_note": "robots.txt disallows /api/*, /rest/v1/* and /trading/*. Reachability check only; not to be used for ingestion.",
        "tls": tls_check("nepsealpha.com"),
    }
    robots = get_with_fallback(base + "/robots.txt")
    out["robots"] = strip_body(robots)
    out["robots"]["text"] = robots["_body"][:1500] if "user-agent" in robots["_body"].lower()[:2000] else None
    out["homepage"] = strip_body(get_with_fallback(base + "/"))
    return out


def probe_yonepse() -> dict:
    """shubhamnpk/yonepse: a hobby project publishing NEPSE JSON on GitHub Pages.
    No licence or upstream source is stated, so it is a last-resort cross-check."""
    base = "https://shubhamnpk.github.io/yonepse"
    out: dict = {"source": "shubhamnpk.github.io/yonepse (static JSON on GitHub Pages)", "files": {}}
    for path in ("/data/market_status.json", "/data/nepse_data.json", "/data/upcoming_ipo.json"):
        got = http_get(base + path)
        entry = strip_body(got)
        if got.get("status") == 200:
            try:
                entry.update(describe(json.loads(got["_body"])))
            except ValueError:
                entry["parse_error"] = "not JSON"
        out["files"][path] = entry
    return out


# --------------------------------------------------------------------------- report


def runner_info() -> dict:
    info = {"github_runner": os.environ.get("RUNNER_NAME"), "runner_os": os.environ.get("RUNNER_OS")}
    got = http_get("https://ipinfo.io/json")
    try:
        data = json.loads(got["_body"])
        info.update({k: data.get(k) for k in ("ip", "city", "region", "country", "org")})
    except ValueError:
        info["ip_lookup_error"] = got.get("error") or f"status {got.get('status')}"
    return info


def yes_no(flag) -> str:
    return "yes" if flag else "NO"


def markdown(report: dict) -> str:
    s = report["sources"]
    lines = [
        "# Phase 0 source probe",
        "",
        f"- Run at: {report['run_at_utc']} UTC = {report['run_at_npt']}",
        f"- Ran from: {report['runner'].get('org')} in {report['runner'].get('city')}, {report['runner'].get('country')} (IP {report['runner'].get('ip')})",
        f"- Trigger: {report['trigger']}",
        "",
        "Every value below was returned by the source during this run.",
        "",
        "## nepalstock.com (NEPSE website API)",
        "",
    ]
    ns = s["nepalstock"]
    if "error" in ns:
        lines += [f"Probe crashed: `{ns['error']}`", ""]
    else:
        lines += [
            f"- TLS certificate verifies with a standard client: **{yes_no(ns['tls'].get('verified'))}** {ns['tls'].get('error', '')}",
            f"- Homepage reachable: **{yes_no(ns['homepage'].get('reachable'))}**, status {ns['homepage'].get('status')}, {ns['homepage'].get('seconds')}s, block signals: {ns['homepage'].get('block_signals') or 'none'}",
            f"- robots.txt is a real rules file: {yes_no(ns['robots'].get('looks_like_robots_file'))}",
            f"- API without a token: status {ns['without_token'].get('status')} ({ns['without_token'].get('body_start')})",
        ]
        lib = ns.get("library", {})
        if "skipped" in lib:
            lines += [f"- Library calls skipped: {lib['skipped']}", ""]
        else:
            lines += [
                f"- Library used TLS verification: {yes_no(lib.get('tls_verification_used'))}",
                f"- Requests sent: {lib.get('request_total')}, HTTP statuses: {lib.get('http_statuses')}",
                f"- Burst of 10 quick calls: {lib.get('burst_10_calls')}",
                "",
                "| Call | OK | Seconds | Rows | Notes |",
                "|---|---|---|---|---|",
            ]
            for name, c in lib.get("calls", {}).items():
                notes = c.get("error") or ""
                if c.get("date_range_first_page"):
                    d = c["date_range_first_page"]
                    notes = f"{d['earliest']} to {d['latest']}; paging {c.get('paging')}"
                elif c.get("paging"):
                    notes = f"paging {c['paging']}"
                elif c.get("type") == "dict":
                    notes = short(c.get("sample", ""), 160)
                lines.append(f"| {name} | {yes_no(c['ok'])} | {c['seconds']} | {c.get('count', '')} | {notes} |".replace("\n", " "))
            lines.append("")

    lines += ["## Open history dataset (Aabishkar2/nepse-data on GitHub)", ""]
    gd = s["github_dataset"]
    if "error" in gd:
        lines += [f"Probe crashed: `{gd['error']}`", ""]
    else:
        lines.append(f"- Last commit: {gd['last_commit'].get('date')}")
        for symbol, f in gd["files"].items():
            if f.get("rows"):
                lines.append(f"- {symbol}: {f['rows']} daily rows, {f['first_row'].get('published_date')} to {f['last_row'].get('published_date')}; last row {f['last_row']}")
            else:
                lines.append(f"- {symbol}: status {f.get('status')} {f.get('error', '')}")
        lines.append("")

    lines += ["## Public sites", "", "| Site | Page | Reachable | Status | Seconds | Needed browser UA | Block signals | Detail |", "|---|---|---|---|---|---|---|---|"]

    def site_row(site, label, r, detail=""):
        lines.append(
            f"| {site} | {label} | {yes_no(r.get('reachable'))} | {r.get('status', '')} | {r.get('seconds', '')} | "
            f"{'yes' if r.get('needed_browser_ua') else 'no'} | {r.get('block_signals') or 'none'} | {detail or r.get('error', '')} |".replace("\n", " ")
        )

    ss, ml, na, yo = s["sharesansar"], s["merolagani"], s["nepsealpha"], s["yonepse"]
    if "error" not in ss:
        site_row("Sharesansar", "robots.txt", ss["robots"], short(ss["robots"].get("text", ""), 80))
        t = ss["today_share_price"]
        site_row("Sharesansar", "today-share-price", t, f"{t.get('table_rows')} rows; {t.get('as_of_text')}; ACLBSL {t.get('sample_rows', {}).get('ACLBSL')}")
    if "error" not in ml:
        site_row("Merolagani", "robots.txt", ml["robots"], "real rules file: " + yes_no(ml["robots"].get("looks_like_robots_file")))
        t = ml["latest_market"]
        site_row("Merolagani", "LatestMarket.aspx", t, f"{t.get('table_rows')} rows; {t.get('as_of_text')}")
    if "error" not in na:
        site_row("NepseAlpha", "robots.txt", na["robots"])
        site_row("NepseAlpha", "homepage", na["homepage"])
    if "error" not in yo:
        for path, f in yo["files"].items():
            site_row("yonepse", path, f, f"{f.get('count', '')} items; last-modified {f.get('last_modified')}")
    for key in ("sharesansar", "merolagani", "nepsealpha", "yonepse"):
        if "error" in s[key]:
            lines.append(f"| {key} | probe crashed | NO | | | | | `{s[key]['error']}` |")
    lines += ["", "Full detail: `reports/phase0/latest.json`.", ""]
    return "\n".join(lines)


def main() -> int:
    started = now_utc()
    report: dict = {
        "run_at_utc": started.strftime("%Y-%m-%d %H:%M:%S"),
        "run_at_npt": npt_string(started),
        "trigger": os.environ.get("GITHUB_EVENT_NAME", "local"),
        "runner": runner_info(),
        "sources": {},
    }
    probes = {
        "nepalstock": probe_nepalstock,
        "github_dataset": probe_github_dataset,
        "sharesansar": probe_sharesansar,
        "merolagani": probe_merolagani,
        "nepsealpha": probe_nepsealpha,
        "yonepse": probe_yonepse,
    }
    for name, probe in probes.items():
        print(f"::group::{name}", flush=True)
        try:
            report["sources"][name] = probe()
        except Exception as exc:  # noqa: BLE001 - one broken probe must not hide the others
            report["sources"][name] = {"error": f"{type(exc).__name__}: {exc}", "trace": traceback.format_exc()[-1500:]}
        print(json.dumps(report["sources"][name], indent=2, default=str, ensure_ascii=False), flush=True)
        print("::endgroup::", flush=True)

    report["duration_seconds"] = round((now_utc() - started).total_seconds(), 1)

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / "latest.json").write_text(json.dumps(report, indent=2, default=str, ensure_ascii=False) + "\n")
    summary = markdown(report)
    (REPORT_DIR / "latest.md").write_text(summary)

    # One line per run, so reliability over many runs can be judged later.
    ns = report["sources"]["nepalstock"]
    calls = ns.get("library", {}).get("calls", {}) if isinstance(ns.get("library"), dict) else {}
    history = REPORT_DIR / "history.csv"
    new_file = not history.exists()
    with history.open("a", newline="") as handle:
        writer = csv.writer(handle)
        if new_file:
            writer.writerow(["run_at_utc", "run_at_npt", "trigger", "runner_country", "nepse_tls_verified", "nepse_homepage_status", "nepse_calls_ok", "nepse_calls_total", "sharesansar_status", "dataset_last_date"])
        writer.writerow([
            report["run_at_utc"], report["run_at_npt"], report["trigger"], report["runner"].get("country"),
            ns.get("tls", {}).get("verified"), ns.get("homepage", {}).get("status"),
            sum(1 for c in calls.values() if c.get("ok")), len(calls),
            report["sources"]["sharesansar"].get("today_share_price", {}).get("status"),
            (report["sources"]["github_dataset"].get("files", {}).get("NABIL", {}).get("last_row") or {}).get("published_date"),
        ])

    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a") as handle:
            handle.write(summary)
    print(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
