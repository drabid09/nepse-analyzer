"""End-of-day fallback: Sharesansar's "today share price" page (Phase 0 decision 3).

Used only when NEPSE's own lists cannot be read. One request per day.
Phase 0 found robots.txt allows all paths and the terms say nothing about
automated access; the page is server-rendered HTML with a table whose headers
were, on 23 Nov 2026:

    S.No | Symbol | Conf. | Open | High | Low | Close | LTP | Close - LTP |
    Close - LTP % | VWAP | Vol | Prev. Close | Turnover | Trans. | Diff | ...

and an "As of : YYYY-MM-DD" line above it. Columns are found by header name,
so a reordering does not break the parser; a renamed column makes it stop
with a clear error instead of guessing.
"""

from __future__ import annotations

import re
from datetime import date
from html.parser import HTMLParser

import httpx

from common import JobError, num, whole

URL = "https://www.sharesansar.com/today-share-price"
USER_AGENT = "nepse-analyzer/1.0 (+https://github.com/drabid09/nepse-analyzer; end-of-day fallback, one request a day)"
REQUIRED = {"Symbol", "Open", "High", "Low", "Close", "Vol", "Prev. Close", "Turnover"}


class _Tables(HTMLParser):
    """Every table on the page as (header cells, body rows). A row made of <th>
    cells is a header; a row with <td> cells is data. Text inside links and
    other tags in a cell is joined."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables: list[dict] = []
        self.stack: list[dict] = []
        self.cell: list[str] | None = None
        self.row: list[str] | None = None
        self.row_is_header = False

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            table = {"id": dict(attrs).get("id"), "header": [], "rows": []}
            self.tables.append(table)
            self.stack.append(table)
        elif not self.stack:
            return
        elif tag == "tr":
            self.row, self.row_is_header = [], False
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []
            self.row_is_header = self.row_is_header or tag == "th"

    def handle_endtag(self, tag):
        if not self.stack:
            return
        if tag == "table":
            self.stack.pop()
        elif tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            table = self.stack[-1]
            if self.row_is_header and not table["header"]:
                table["header"] = self.row
            elif not self.row_is_header and self.row:
                table["rows"].append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def parse(html: str) -> tuple[date | None, list[dict]]:
    text = re.sub(r"<[^>]+>", " ", html)
    match = re.search(r"As of\s*:?\s*(\d{4}-\d{2}-\d{2})", text)
    as_of = date.fromisoformat(match.group(1)) if match else None
    parser = _Tables()
    parser.feed(html)
    table = next((t for t in parser.tables if REQUIRED <= set(t["header"])), None)
    if table is None:
        seen = [t["header"][:6] for t in parser.tables if t["header"]][:3]
        raise JobError(f"Sharesansar's price table changed: no table with columns {sorted(REQUIRED)} (saw {seen})")
    col = {name: i for i, name in enumerate(table["header"])}

    def cell(cells, name):
        i = col.get(name)
        return cells[i].replace(",", "") if i is not None and i < len(cells) else None

    rows = []
    for cells in table["rows"]:
        symbol = (cell(cells, "Symbol") or "").strip().upper()
        if not symbol:
            continue
        rows.append({
            "securityId": None, "symbol": symbol,
            "open": num(cell(cells, "Open")), "high": num(cell(cells, "High")), "low": num(cell(cells, "Low")),
            "close": num(cell(cells, "Close")) or num(cell(cells, "LTP")),
            "prev_close": num(cell(cells, "Prev. Close")),
            "volume": whole(cell(cells, "Vol")) or 0, "turnover": num(cell(cells, "Turnover")),
            "trades": whole(cell(cells, "Trans.")),
        })
    return as_of, rows


def fetch_today() -> tuple[date | None, list[dict]]:
    try:
        response = httpx.get(URL, headers={"User-Agent": USER_AGENT}, timeout=30, follow_redirects=True)
    except httpx.TransportError as exc:
        raise JobError(f"Sharesansar unreachable: {type(exc).__name__}") from exc
    if response.status_code != 200:
        raise JobError(f"Sharesansar answered HTTP {response.status_code}")
    return parse(response.text)
