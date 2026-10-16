"""Parser for Senate e-file PTR HTML pages.

The table has 9 columns:
  # | Transaction Date | Owner | Ticker | Asset Name | Asset Type | Type | Amount | Comment
"""

import re
from datetime import date, datetime

from bs4 import BeautifulSoup

from congressional.models import TradeRecord, is_ticker

# "Self" is an explicit disclosure on Senate filings — store it as its own
# code rather than collapsing it into NULL, which the API reports as
# "Undisclosed". Rows parsed before 2026-06-10 stored NULL; re-running
# `trade-parser senate parse-ptrs <year> --redo` recovers them.
OWNER_LABEL_TO_CODE: dict[str, str | None] = {
    "self": "SELF",
    "joint": "JT",
    "spouse": "SP",
    "dependent child": "DC",
    "child": "DC",
}

# Map the Senate's human-readable transaction labels to our normalized codes.
TRANSACTION_LABEL_TO_CODE: dict[str, str] = {
    "purchase": "P",
    "sale (full)": "S",
    "sale full": "S",
    "sale (partial)": "S (partial)",
    "sale partial": "S (partial)",
    "exchange": "E",
}


def _norm(text: str | None) -> str:
    if text is None:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def _parse_date(s: str) -> date | None:
    try:
        return datetime.strptime(s.strip(), "%m/%d/%Y").date()
    except ValueError:
        return None


def _parse_owner(label: str) -> str | None:
    return OWNER_LABEL_TO_CODE.get(label.strip().lower())


def _parse_transaction_type(label: str) -> str | None:
    key = label.strip().lower()
    if key in TRANSACTION_LABEL_TO_CODE:
        return TRANSACTION_LABEL_TO_CODE[key]
    # Generic fallback for unexpected labels.
    if "purchase" in key:
        return "P"
    if "partial" in key:
        return "S (partial)"
    if "sale" in key:
        return "S"
    if "exchange" in key:
        return "E"
    return None


def _parse_amount_bounds(amount_raw: str) -> tuple[int | None, int | None]:
    text = amount_raw.strip()
    if "over" in text.lower():
        m = re.search(r"\$([\d,]+(?:\.\d{1,2})?)", text)
        return (_to_dollars(m.group(1)) if m else None, None)
    parts = re.findall(r"\$?([\d,]+(?:\.\d{1,2})?)", text)
    low = _to_dollars(parts[0]) if parts else None
    high = _to_dollars(parts[1]) if len(parts) >= 2 else low
    return low, high


def _to_dollars(s: str) -> int | None:
    s = s.replace(",", "").replace("$", "").strip()
    if "." in s:
        s = s.split(".", 1)[0]
    return int(s) if s.isdigit() else None


def parse_ptr_html(html: str, doc_id: str) -> list[TradeRecord]:
    """Parse a Senate e-file PTR page into TradeRecords. Returns [] if the
    expected table isn't present (e.g., paper filings, error pages)."""
    soup = BeautifulSoup(html, "lxml")

    table = soup.find("table", class_="table-striped")
    if table is None:
        return []
    tbody = table.find("tbody")
    if tbody is None:
        return []

    trades: list[TradeRecord] = []
    for tr in tbody.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
        if len(cells) < 8:
            continue

        line_no_raw = cells[0]
        tx_date = _parse_date(cells[1])
        owner_label = cells[2]
        ticker = _norm(cells[3]) or None
        asset_name = _norm(cells[4])
        asset_type = _norm(cells[5]) or None
        tx_type = _parse_transaction_type(cells[6])
        amount_raw = _norm(cells[7])

        amount_low, amount_high = _parse_amount_bounds(amount_raw)

        try:
            line_no = int(line_no_raw)
        except ValueError:
            line_no = None

        # The Senate UI renders `--` for empty tickers; treat that as None.
        if ticker in {"--", "—", ""}:
            ticker = None
        # Reject CUSIPs / junk so bonds stay non-ticker assets, not fake issuers.
        if ticker and not is_ticker(ticker):
            ticker = None

        trades.append(
            TradeRecord(
                doc_id=doc_id,
                line_number=line_no,
                owner=_parse_owner(owner_label),
                asset_name=asset_name,
                asset_ticker=ticker,
                asset_type=asset_type,
                transaction_type=tx_type,
                transaction_date=tx_date,
                notification_date=None,  # Senate e-files don't show a notification date
                amount_range_low=amount_low,
                amount_range_high=amount_high,
                amount_range_raw=amount_raw,
                cap_gains_over_200=None,
            )
        )

    return trades
