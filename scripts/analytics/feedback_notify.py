#!/usr/bin/env python3
"""Tells the owner about new feedback from the dashboard.

For each message not yet notified, it opens a GitHub issue that tags the owner,
so GitHub emails them. The repository is public, so the issue says only that a
message arrived, its number and kind; the message itself stays private in the
database (Supabase, Table Editor, feedback). Nothing from the message is
printed to the log either, because workflow logs are public too.

A row is marked as notified only after its issue exists. If GitHub refuses,
the run fails (and GitHub emails the owner about the failed run instead), and
the next run tries again.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "ingest"))
from common import NPT, JobError, Supabase, write_summary  # noqa: E402

OWNER = os.environ.get("NOTIFY_USER", "drabid09")
TABLE_URL = "https://supabase.com/dashboard/project/tpmlcthylkmrxsnazfef/editor"
KIND_TEXT = {
    "request": "a request to see something new",
    "idea": "a view or an idea",
    "problem": "a report that something looks wrong",
    "other": "a message",
}
BATCH = 20


def issue_for(row: dict) -> dict:
    """Title and body for one message. Uses only the id, kind and time: never the text."""
    kind = KIND_TEXT.get(row.get("kind"), "a message")
    when = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00")).astimezone(NPT)
    return {
        "title": f"Dashboard feedback #{row['id']}: {kind}",
        "body": (
            f"@{OWNER} new feedback arrived on the dashboard: {kind}, "
            f"sent {when:%d %b %Y at %H:%M} Nepal time.\n\n"
            f"The message is private, so it is not shown here. Read it in Supabase: "
            f"[Table Editor]({TABLE_URL}), table `feedback`, row {row['id']}.\n\n"
            "When you have looked at it, set its `status` there (seen, planned, done or declined) "
            "and close this issue."
        ),
    }


def notify(db: Supabase, github: httpx.Client, repo: str) -> list[int]:
    rows = db.select("feedback", select="id,created_at,kind", notified_at="is.null", order="id.asc", limit=BATCH)
    done: list[int] = []
    for row in rows:
        try:
            response = github.post(f"/repos/{repo}/issues", json=issue_for(row))
        except httpx.HTTPError as exc:
            raise JobError(f"GitHub unreachable while notifying feedback #{row['id']}: {type(exc).__name__}") from exc
        if response.status_code != 201:
            raise JobError(f"GitHub refused the issue for feedback #{row['id']}: HTTP {response.status_code}")
        number = response.json()["number"]
        db.update("feedback", {"notified_at": datetime.now(timezone.utc).isoformat(), "issue_number": number}, id=f"eq.{row['id']}")
        done.append(row["id"])
    return done


def main() -> None:
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    if not repo or not token:
        raise JobError("GITHUB_REPOSITORY and GITHUB_TOKEN are needed (they are set inside GitHub Actions)")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    with httpx.Client(base_url="https://api.github.com", headers=headers, timeout=30) as github:
        done = notify(Supabase(), github, repo)
    write_summary(f"## Feedback\n\n{len(done)} new message(s) notified" + (f": #{', #'.join(map(str, done))}" if done else "") + ".")


if __name__ == "__main__":
    try:
        main()
    except JobError as exc:
        write_summary(f"## Feedback notification failed\n\n{exc}")
        sys.exit(1)
