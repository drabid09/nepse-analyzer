"""Shared pieces for the fetch jobs: a guarded NEPSE client and a Supabase writer.

Secrets come from environment variables only (GitHub Actions secrets, or a local
.env on a fallback machine in Nepal). They are never printed or written to disk.
"""

from __future__ import annotations

import os
import sys

import httpx


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


def run(main) -> None:
    """Run a job; turn explainable failures into one clear line and exit code 1."""
    try:
        main()
    except JobError as exc:
        print(f"::error::{exc}", flush=True)
        sys.exit(1)
