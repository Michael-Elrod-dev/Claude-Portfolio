"""Senate DataTables-backed search for Periodic Transaction Reports."""

import re
from collections.abc import Iterator
from datetime import date, datetime

from congressional.models import FilingRecord
from congressional.senate.client import BASE_URL, SenateClient

# Senate report_type codes (from the search form).
REPORT_TYPE_PTR = 11

# Senate filer_type codes.
FILER_TYPE_SENATOR = 1

# DataTables page size. The Senate site silently caps at ~100; stay well under.
PAGE_SIZE = 100


def _build_datatables_payload(
    *,
    start: int,
    length: int,
    submitted_start: str,
    submitted_end: str,
    csrf: str,
    report_types: list[int],
    filer_types: list[int],
) -> dict:
    payload: dict[str, str] = {}
    for i in range(5):
        payload[f"columns[{i}][data]"] = str(i)
        payload[f"columns[{i}][name]"] = ""
        payload[f"columns[{i}][searchable]"] = "true"
        payload[f"columns[{i}][orderable]"] = "true"
        payload[f"columns[{i}][search][value]"] = ""
        payload[f"columns[{i}][search][regex]"] = "false"
    payload.update(
        {
            "draw": "1",
            "order[0][column]": "4",
            "order[0][dir]": "desc",
            "start": str(start),
            "length": str(length),
            "search[value]": "",
            "search[regex]": "false",
            "report_types": "[" + ",".join(str(r) for r in report_types) + "]",
            "filer_types": "[" + ",".join(str(f) for f in filer_types) + "]",
            "submitted_start_date": submitted_start,
            "submitted_end_date": submitted_end,
            "candidate_state": "",
            "senator_state": "",
            "office_id": "",
            "first_name": "",
            "last_name": "",
            "csrfmiddlewaretoken": csrf,
        }
    )
    return payload


HREF_RE = re.compile(r'href="(/search/view/(ptr|paper)/([0-9a-f-]+)/?)"')


def _parse_row(row: list[str]) -> FilingRecord | None:
    """Convert one DataTables result row into a FilingRecord, or None if unparseable."""
    if len(row) < 5:
        return None
    first = row[0].strip()
    last = row[1].strip()
    link_html = row[3]
    filed_str = row[4].strip()

    m = HREF_RE.search(link_html)
    if not m:
        return None
    path, _kind, uuid = m.group(1), m.group(2), m.group(3)

    filing_date: date | None = None
    try:
        filing_date = datetime.strptime(filed_str, "%m/%d/%Y").date()
    except ValueError:
        pass

    if filing_date is None:
        return None

    return FilingRecord(
        doc_id=uuid,
        chamber="S",
        first=first,
        last=last,
        state_district=None,  # not available in search response
        filing_type="P",
        filing_year=filing_date.year,
        filing_date=filing_date,
        source_url=f"{BASE_URL}{path}",
    )


def search_ptrs(
    client: SenateClient,
    *,
    year: int,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Iterator[FilingRecord]:
    """Stream FilingRecords for senator PTRs submitted in `year`.

    Pass date_from / date_to to narrow the window (e.g. for incremental polling).
    Both default to the full calendar year.
    """
    submitted_start = (
        date_from.strftime("%m/%d/%Y 00:00:00") if date_from else f"01/01/{year} 00:00:00"
    )
    submitted_end = date_to.strftime("%m/%d/%Y 23:59:59") if date_to else f"12/31/{year} 23:59:59"

    start = 0
    while True:
        payload = _build_datatables_payload(
            start=start,
            length=PAGE_SIZE,
            submitted_start=submitted_start,
            submitted_end=submitted_end,
            csrf=client.search_csrf,
            report_types=[REPORT_TYPE_PTR],
            filer_types=[FILER_TYPE_SENATOR],
        )
        data = client.search_post(payload).json()
        rows = data.get("data") or []
        if not rows:
            break

        for raw in rows:
            rec = _parse_row(raw)
            if rec is not None:
                yield rec

        total = data.get("recordsFiltered") or 0
        start += len(rows)
        if start >= total or len(rows) < PAGE_SIZE:
            break
