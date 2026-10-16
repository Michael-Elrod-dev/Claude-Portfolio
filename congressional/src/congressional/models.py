import re
from datetime import date

from pydantic import BaseModel

# A real US stock ticker: 1–6 letters with an optional .B / -A class suffix.
# Bonds/Treasuries/munis carry a 9-char alphanumeric CUSIP (e.g. "912796CR8")
# in their parenthesized id, which the PTR parsers would otherwise capture as a
# ticker — `is_ticker` rejects those so they stay non-ticker assets.
_TICKER_RE = re.compile(r"^[A-Z]{1,6}([.\-][A-Z]{1,4})?$")


def is_ticker(value: str | None) -> bool:
    """True if `value` looks like a real stock ticker (not a CUSIP or junk)."""
    return bool(value) and bool(_TICKER_RE.match(value.strip().upper()))


TRANSACTION_TYPE_LABELS: dict[str, str] = {
    "P": "Purchase",
    "S": "Sale (full)",
    "S (partial)": "Sale (partial)",
    "E": "Exchange",
}

OWNER_CODE_LABELS: dict[str, str] = {
    "SP": "Spouse",
    "DC": "Dependent Child",
    "JT": "Joint",
}

FILING_TYPE_LABELS: dict[str, str] = {
    "P": "Periodic Transaction Report",
    "A": "Annual Report",
    "C": "Candidate Report",
    "O": "Officer/Employee Report",
    "T": "Termination Report",
    "D": "Due Date Extension",
    "E": "Extension",
    "W": "Withdrawal",
    "X": "Amendment",
}


class FilingRecord(BaseModel):
    doc_id: str
    chamber: str  # 'H' or 'S'
    prefix: str | None = None
    first: str
    last: str
    suffix: str | None = None
    state_district: str | None = None
    filing_type: str
    filing_year: int
    filing_date: date | None = None
    source_url: str | None = None

    @property
    def filing_type_label(self) -> str:
        return FILING_TYPE_LABELS.get(self.filing_type, "Unknown")


class TradeRecord(BaseModel):
    doc_id: str
    line_number: int | None = None
    owner: str | None = None
    asset_name: str
    asset_ticker: str | None = None
    asset_type: str | None = None
    transaction_type: str | None = None
    transaction_date: date | None = None
    notification_date: date | None = None
    amount_range_low: int | None = None
    amount_range_high: int | None = None
    amount_range_raw: str | None = None
    cap_gains_over_200: bool | None = None


# Reject transaction dates that can't be real — future dates (you can't disclose a
# trade that hasn't happened yet) and ancient sentinels (e.g. 1900-01-01) that come
# from upstream parser typos. We null the date rather than drop the whole trade, so
# the row survives but won't pollute date-sorted/anchored queries (transaction_date
# is the IS NOT NULL gate + default sort).
_MIN_YEARS_BEFORE_FILING = 2


def plausible_transaction_date(d: date | None, filing_year: int, today: date) -> date | None:
    """Return `d` if it's a sane transaction date for a `filing_year` filing, else
    None. Sane = within [filing_year - 2, today]."""
    if d is None:
        return None
    floor = date(filing_year - _MIN_YEARS_BEFORE_FILING, 1, 1)
    if d < floor or d > today:
        return None
    return d


def sanitize_trade_dates(trade_dicts: list[dict], filing_year: int, today: date) -> int:
    """Null implausible `transaction_date`s in a batch of trade dicts in place;
    return how many were nulled (for logging)."""
    dropped = 0
    for td in trade_dicts:
        raw = td.get("transaction_date")
        clean = plausible_transaction_date(raw, filing_year, today)
        if raw is not None and clean is None:
            dropped += 1
        td["transaction_date"] = clean
    return dropped
