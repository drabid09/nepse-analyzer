"""Shared pieces for the fetch jobs: a guarded NEPSE client and a Supabase writer.

Secrets come from environment variables only (GitHub Actions secrets, or a local
.env on a fallback machine in Nepal). They are never printed or written to disk.
"""

from __future__ import annotations

import os
import socket
import sys
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import httpx

NPT = ZoneInfo("Asia/Kathmandu")  # Nepal time, UTC+05:45. NEPSE trades 11:00-15:00, Monday to Friday.


def now_npt() -> datetime:
    return datetime.now(NPT)


def num(value, digits: int | None = 2) -> float | None:
    """A NEPSE number as float (rounded), or None when missing or not a number."""
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result:  # NaN
        return None
    return round(result, digits) if digits is not None else result


def whole(value) -> int | None:
    result = num(value, None)
    return int(round(result)) if result is not None else None


def write_summary(text: str) -> None:
    """Print a report and add it to the GitHub Actions run summary."""
    print(text, flush=True)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as handle:
            handle.write(text + "\n")


class JobError(RuntimeError):
    """A failure we can explain in one line. Shown without a stack trace."""


# ----------------------------------------------------------------------- NEPSE


class RequestBudget:
    """Stops the unofficial NEPSE library from retrying forever.

    The library answers transport errors and expired tokens by calling itself
    again with no limit. Against a blocked or changed server that would mean
    hundreds of requests, so every request passes through this counter and a
    call that exceeds its budget is aborted with an error the library does not
    catch.
    """

    class Exhausted(JobError):
        pass

    def __init__(self, client: httpx.Client, per_call: int = 12, max_transport_errors: int = 3):
        self.per_call = per_call
        self.max_transport_errors = max_transport_errors
        self.total = 0
        self.reset()
        for method in ("get", "post"):
            self._wrap(client, method)

    def reset(self) -> None:
        self.in_call = 0
        self.transport_errors = 0

    def _wrap(self, client: httpx.Client, method: str) -> None:
        original = getattr(client, method)

        def guarded(*args, **kwargs):
            self.in_call += 1
            self.total += 1
            if self.in_call > self.per_call:
                raise self.Exhausted(f"NEPSE needed more than {self.per_call} requests for one call")
            try:
                return original(*args, **kwargs)
            except httpx.TransportError as exc:
                self.transport_errors += 1
                if self.transport_errors >= self.max_transport_errors:
                    raise self.Exhausted(f"NEPSE unreachable: {type(exc).__name__}: {exc}") from exc
                raise

        setattr(client, method, guarded)


class NepseSource:
    """The `nepse` library with TLS verification on and a request budget."""

    def __init__(self):
        from nepse import Nepse

        self.api = Nepse()
        # Verification stays on. If NEPSE's certificate chain breaks again, the
        # fix is to add the missing intermediate certificate, not to turn this off.
        self.api.setTLSVerification(True)
        self.api.client.timeout = httpx.Timeout(30)  # library default is 100 s
        self.budget = RequestBudget(self.api.client)

    def call(self, method_name: str, *args, **kwargs):
        self.budget.reset()
        try:
            return getattr(self.api, method_name)(*args, **kwargs)
        except JobError:
            raise
        except Exception as exc:  # noqa: BLE001 - library raises bare custom errors
            raise JobError(f"NEPSE call {method_name} failed: {type(exc).__name__}: {exc}") from exc


# ----------------------------------------------------------------------- Supabase


class Supabase:
    """Minimal writer for Supabase's REST interface, using the service key.

    The service key bypasses row level security, which is exactly why it lives
    only in secrets and only in the fetch jobs.
    """

    def __init__(self):
        url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
        missing = [n for n, v in (("SUPABASE_URL", url), ("SUPABASE_SERVICE_KEY", key)) if not v]
        if missing:
            raise JobError(f"Missing secret(s): {', '.join(missing)}. Add them under repository Settings > Secrets and variables > Actions.")
        if not url.startswith("https://"):
            raise JobError("SUPABASE_URL must start with https://")
        self.client = httpx.Client(
            base_url=f"{url}/rest/v1",
            timeout=30,
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        )

    def _send(self, what: str, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            response = self.client.request(method, path, **kwargs)
        except httpx.TransportError as exc:
            raise JobError(f"Supabase unreachable while trying to {what}: {type(exc).__name__}") from exc
        if response.status_code >= 400:
            # PostgREST error bodies describe the problem and contain no secrets.
            raise JobError(f"Supabase refused to {what}: HTTP {response.status_code} {response.text[:300]}")
        return response

    def select(self, table: str, **params) -> list[dict]:
        return self._send(f"read {table}", "GET", f"/{table}", params=params).json()

    def select_all(self, table: str, page: int = 1000, **params) -> list[dict]:
        """Every matching row. The API returns at most 1,000 rows per request."""
        rows: list[dict] = []
        while True:
            chunk = self._send(
                f"read {table}", "GET", f"/{table}", params=params,
                headers={"Range-Unit": "items", "Range": f"{len(rows)}-{len(rows) + page - 1}"},
            ).json()
            rows.extend(chunk)
            if len(chunk) < page:
                return rows

    def rpc(self, function: str, args: dict | None = None, *, page: int = 1000):
        """Call one of the helper functions from migration 4 (all rows, if it returns a set)."""
        rows: list = []
        while True:
            result = self._send(
                f"call {function}", "POST", f"/rpc/{function}", json=args or {},
                headers={"Range-Unit": "items", "Range": f"{len(rows)}-{len(rows) + page - 1}"},
            ).json()
            if not isinstance(result, list):
                return result
            rows.extend(result)
            if len(result) < page:
                return rows

    def insert_returning(self, table: str, row: dict) -> dict:
        response = self._send(f"write {table}", "POST", f"/{table}", headers={"Prefer": "return=representation"}, json=row)
        return response.json()[0]

    def update(self, table: str, values: dict, **filters) -> None:
        if not filters:
            raise JobError(f"refusing to update every row of {table}")
        self._send(f"update {table}", "PATCH", f"/{table}", params=filters, headers={"Prefer": "return=minimal"}, json=values)

    def delete(self, table: str, **filters) -> int:
        if not filters:
            raise JobError(f"refusing to delete every row of {table}")
        response = self._send(
            f"clean up {table}", "DELETE", f"/{table}", params=filters,
            headers={"Prefer": "return=minimal,count=exact"},
        )
        return int(response.headers.get("content-range", "*/0").split("/")[-1] or 0)

    def count(self, table: str, **filters) -> int:
        response = self._send(
            f"count {table}", "GET", f"/{table}",
            params={"select": "*", **filters}, headers={"Prefer": "count=exact", "Range": "0-0"},
        )
        return int(response.headers.get("content-range", "*/0").split("/")[-1])

    def upsert(self, table: str, rows: list[dict], on_conflict: str, *, ignore_duplicates: bool = False, batch: int = 500) -> int:
        """Insert rows, updating (or skipping) those whose key already exists.

        Safe to repeat: running the same job twice leaves the same data.
        Every row in one call must have the same set of keys.
        """
        resolution = "ignore-duplicates" if ignore_duplicates else "merge-duplicates"
        for start in range(0, len(rows), batch):
            self._send(
                f"write {table}", "POST", f"/{table}",
                params={"on_conflict": on_conflict},
                headers={"Prefer": f"resolution={resolution},return=minimal"},
                json=rows[start : start + batch],
            )
        return len(rows)


# ----------------------------------------------------------------------- run log


def runner_name() -> str:
    if os.environ.get("GITHUB_ACTIONS") == "true":
        return "github-actions"
    return os.environ.get("RUNNER_LABEL") or socket.gethostname()


def started_by_hand() -> bool:
    """True for a run started from GitHub's "Run workflow" button or by a push.

    Such runs redo work that is already done. Runs started on a timer (GitHub's
    schedule, or the Supabase timer, which sends the input timer=true) do not.
    """
    return (os.environ.get("GITHUB_EVENT_NAME") in ("push", "workflow_dispatch")
            and os.environ.get("RUN_BY_TIMER") != "1")


def run_url() -> str | None:
    if os.environ.get("GITHUB_RUN_ID"):
        return f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    return None


class JobRun:
    """One row in job_runs: the website's "last updated" stamp and health badge.

    Logging must never be the reason a job fails, so errors while writing the
    log itself are printed and otherwise ignored.
    """

    def __init__(self, db: Supabase, job: str, trade_date: date | None = None, source: str | None = "nepse"):
        self.db = db
        self.id = None
        try:
            row = db.insert_returning("job_runs", {
                "job": job, "status": "running", "runner": runner_name(), "run_url": run_url(),
                "source": source, "trade_date": trade_date.isoformat() if trade_date else None,
            })
            self.id = row["id"]
        except JobError as exc:
            print(f"::warning::could not start the run log: {exc}", flush=True)

    def update(self, **values) -> None:
        if self.id is None:
            return
        values = {k: (v.isoformat() if isinstance(v, (date, datetime)) else v) for k, v in values.items()}
        values["heartbeat_at"] = datetime.now(timezone.utc).isoformat()
        try:
            self.db.update("job_runs", values, id=f"eq.{self.id}")
        except JobError as exc:
            print(f"::warning::could not update the run log: {exc}", flush=True)

    def finish(self, status: str, message: str, **values) -> None:
        self.update(status=status, message=message[:500], finished_at=datetime.now(timezone.utc), **values)


def company_maps(db: Supabase) -> tuple[dict[str, int], dict[str, int]]:
    """(NEPSE security id -> company id, symbol -> company id)."""
    rows = db.select_all("companies", select="id,symbol,nepse_security_id", order="id")
    by_security = {str(r["nepse_security_id"]): r["id"] for r in rows if r.get("nepse_security_id") is not None}
    by_symbol = {r["symbol"].upper(): r["id"] for r in rows}
    return by_security, by_symbol


def lookup_company(row: dict, by_security: dict[str, int], by_symbol: dict[str, int]) -> int | None:
    security = row.get("securityId", row.get("stockId"))
    if security is not None and str(security) in by_security:
        return by_security[str(security)]
    symbol = str(row.get("symbol") or row.get("stockSymbol") or "").strip().upper()
    return by_symbol.get(symbol)


def previous_index_closes(db: "Supabase", trade_date: date) -> dict[int, float]:
    """Each index's last final close before trade_date, from our own index_daily table."""
    last = db.select("index_daily", select="date", is_final="eq.true", date=f"lt.{trade_date.isoformat()}",
                     order="date.desc", limit=1)
    if not last:
        return {}
    rows = db.select("index_daily", select="index_id,close", is_final="eq.true", date=f"eq.{last[0]['date']}")
    return {int(r["index_id"]): float(r["close"]) for r in rows if r.get("close") is not None}


def settle_index_prev_close(rows: list[dict], previous: dict[int, float]) -> list[dict]:
    """Repairs a previous close that NEPSE has already rolled over.

    Once the market has shut, getNepseIndex reports previousClose equal to the
    close for the main indices, so the NEPSE Index showed 0.00% on 23 Nov 2026
    (the real change was +2.27 points from 2,621.29). Where the reported previous
    close is missing or identical to the close, the last final close we stored is
    used instead. A previous close that differs from the close is left alone.
    """
    for row in rows:
        stored = previous.get(row.get("index_id"))
        close, prev = row.get("close"), row.get("prev_close")
        if stored is None or close is None:
            continue
        if prev is None or abs(float(prev) - float(close)) < 0.005:
            row["prev_close"] = round(stored, 2)
    return rows


def run(main) -> None:
    """Run a job; turn explainable failures into one clear line and exit code 1."""
    try:
        main()
    except JobError as exc:
        print(f"::error::{exc}", flush=True)
        sys.exit(1)
