"""Feedback notifications: the owner is tagged, the message text never leaves
the database, and a row is only marked once its issue exists."""

from __future__ import annotations

import json

import httpx
import pytest

import feedback_notify as fn
from common import JobError
from conftest import FakeDB

SECRET_TEXT = "I bought 500 NABIL at 540, should I hold?"


class Store(FakeDB):
    def __init__(self, rows):
        super().__init__(tables={"feedback": rows})
        self.updates = []

    def select(self, table, **params):
        rows = [r for r in self.tables[table] if r.get("notified_at") is None]
        return [{k: r[k] for k in ("id", "created_at", "kind")} for r in rows]

    def update(self, table, values, **filters):
        self.updates.append((table, values, filters))
        rid = int(filters["id"].split(".")[1])
        for r in self.tables[table]:
            if r["id"] == rid:
                r.update(values)


def rows():
    return [
        {"id": 1, "created_at": "2026-11-23T09:10:00+00:00", "kind": "idea", "message": SECRET_TEXT, "notified_at": None},
        {"id": 2, "created_at": "2026-11-23T09:20:00+00:00", "kind": "problem", "message": "Price of XYZCO seems off since Tuesday", "notified_at": None},
    ]


def github(status=201):
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(status, json={"number": 100 + len(sent)})

    return httpx.Client(transport=httpx.MockTransport(handler), base_url="https://api.github.com"), sent


def test_each_new_message_opens_one_issue_that_tags_the_owner():
    db = Store(rows())
    client, sent = github()
    assert fn.notify(db, client, "drabid09/nepse-analyzer") == [1, 2]
    assert len(sent) == 2
    assert all("@drabid09" in issue["body"] for issue in sent)
    assert sent[0]["title"] == "Dashboard feedback #1: a view or an idea"
    assert "14:55 Nepal time" in sent[0]["body"]   # 09:10 UTC is 14:55 in Nepal
    assert [u[1]["issue_number"] for u in db.updates] == [101, 102]


def test_the_message_text_is_never_sent_to_github():
    client, sent = github()
    fn.notify(Store(rows()), client, "drabid09/nepse-analyzer")
    everything = json.dumps(sent)
    assert "NABIL" not in everything and "540" not in everything and "XYZCO" not in everything and "Tuesday" not in everything


def test_already_notified_messages_are_skipped():
    data = rows()
    data[0]["notified_at"] = "2026-11-23T09:30:00+00:00"
    client, sent = github()
    assert fn.notify(Store(data), client, "drabid09/nepse-analyzer") == [2]
    assert len(sent) == 1


def test_a_refused_issue_leaves_the_message_for_the_next_run():
    db = Store(rows())
    client, _ = github(status=403)
    with pytest.raises(JobError, match="HTTP 403"):
        fn.notify(db, client, "drabid09/nepse-analyzer")
    assert db.updates == []
    assert all(r["notified_at"] is None for r in db.tables["feedback"])
