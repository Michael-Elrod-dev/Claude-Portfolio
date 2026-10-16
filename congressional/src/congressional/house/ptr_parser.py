"""Parser for House Periodic Transaction Report (PTR) PDFs.

Strategy:
  1. Extract text from each page with pdfplumber (table extraction returns mangled
     output because of custom-font CID issues; raw text is consistent).
  2. Locate the transaction section between the column-header line and the next
     non-transaction section (Asset Class Details, footnote, etc.).
  3. Group lines into transaction blocks anchored on lines matching the shape
     `<head> TX_TYPE MM/DD/YYYY MM/DD/YYYY $AMOUNT`.
  4. Reconstruct each transaction by joining wrapped asset-name lines and
     amount-range continuations, stopping when we hit metadata lines
     ("Filing Status:", "Sub Holding Owner:", "Description:", "Location:").
"""

import logging
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import pdfplumber

from congressional.models import TradeRecord, is_ticker

logger = logging.getLogger(__name__)

OWNER_CODES = {"SP", "DC", "JT"}

LINE_ANCHOR = re.compile(
    r"^(?P<head>.+?)\s+"
    r"(?P<tx>S \(partial\)|P|S|E)\s+"
    r"(?P<date1>\d{2}/\d{2}/\d{4})\s+"
    r"(?P<date2>\d{2}/\d{2}/\d{4})\s+"
    r"(?P<spousal>Spouse/DC\s+)?"
    r"(?P<amount_start>"
    r"\$[\d,]+(?:\.\d{1,2})?"  # standard amount or exact (e.g. $1,001 or $350.78)
    r"|Over\s+\$[\d,]+"  # Over $X on same line
    r"|Over"  # Over with $X wrapping to next line
    r")"
    r"(?:\s*-\s*(?P<amount_end>\$?[\d,]+(?:\.\d{1,2})?))?"
    r"\s*-?\s*$"  # tolerate trailing dash when the high amount wraps
)

HEADER_RE = re.compile(r"\bID\b.*\bOwner\b.*\bAsset\b.*\bTransaction\b")

END_MARKERS = (
    "* For the complete list",
    "* Asset class details",
    "Asset Class Details",
    "Initial Public Offerings",
    "Comments",
    "Filer's Notes",
)

# Metadata labels like "F      S     :", "S          O :", "D          :", "L       :"
# render as a single capital letter, spaces, optional second capital letter, then a colon.
METADATA_RE = re.compile(r"^[A-Z](?:\s+[A-Z])?\s*:\s")

# An amount fragment at the end of a continuation line (used to find $high when it wraps).
AMOUNT_TAIL_RE = re.compile(r"\$([\d,]+(?:\.\d{1,2})?)\s*$")

TICKER_RE = re.compile(r"\(([A-Z0-9.\-]{1,15})\)")
ASSET_TYPE_RE = re.compile(r"\[([A-Z]{2,3})\]")

SCANNED_TEXT_THRESHOLD = 100


@dataclass
class _ParsedTrade:
    owner: str | None
    asset_name: str
    asset_ticker: str | None
    asset_type: str | None
    transaction_type: str
    transaction_date: date | None
    notification_date: date | None
    amount_range_low: int | None
    amount_range_high: int | None
    amount_range_raw: str


def extract_full_text(pdf_path: Path) -> str:
    chunks: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            chunks.append(page.extract_text() or "")
    # Custom-font label glyphs ("Filing Status:", "Sub Owner:", etc.) extract as a
    # leading letter followed by NUL bytes. Treat NULs as whitespace so the metadata
    # detector matches and asset names don't slurp the labels.
    return "\n".join(chunks).replace("\x00", " ")


def is_scanned(text: str) -> bool:
    return len(text.strip()) < SCANNED_TEXT_THRESHOLD


def _parse_money(s: str) -> int | None:
    """Parse a money string like '1,001' or '350.78' into integer dollars (cents truncated).

    Cents are dropped; the full original text is preserved in amount_range_raw.
    """
    s = s.replace(",", "").replace("$", "").strip()
    if "." in s:
        s = s.split(".", 1)[0]
    return int(s) if s.isdigit() else None


def _parse_date(s: str) -> date | None:
    try:
        return datetime.strptime(s.strip(), "%m/%d/%Y").date()
    except ValueError:
        return None


def _split_owner(head: str) -> tuple[str | None, str]:
    tokens = head.split(None, 1)
    if len(tokens) >= 2 and tokens[0] in OWNER_CODES:
        return tokens[0], tokens[1].strip()
    return None, head.strip()


def _extract_ticker_and_type(asset_text: str) -> tuple[str, str | None, str | None]:
    ticker_match = TICKER_RE.search(asset_text)
    type_match = ASSET_TYPE_RE.search(asset_text)
    raw_ticker = ticker_match.group(1) if ticker_match else None
    # Reject CUSIPs / junk captured from a bond's parenthesized id — those stay
    # non-ticker assets (classified by name), not fake stock issuers.
    ticker = raw_ticker if is_ticker(raw_ticker) else None
    return (
        asset_text.strip(),
        ticker,
        type_match.group(1) if type_match else None,
    )


def _parse_amount_bounds(raw: str) -> tuple[int | None, int | None]:
    if "over" in raw.lower():
        m = re.search(r"\$([\d,]+(?:\.\d{1,2})?)", raw)
        return (_parse_money(m.group(1)) if m else None, None)
    parts = re.findall(r"\$?([\d,]+(?:\.\d{1,2})?)", raw)
    low = _parse_money(parts[0]) if parts else None
    # Exact amount (no range): high = low so consumers can detect it's a fixed value.
    high = _parse_money(parts[1]) if len(parts) >= 2 else low
    return low, high


def _find_transaction_region(lines: list[str]) -> tuple[int, int] | None:
    """Return (start, end) line indices that bound the transaction rows, or None."""
    start = None
    for i, line in enumerate(lines):
        if HEADER_RE.search(line):
            start = i + 1
            break
    if start is None:
        return None

    # Skip header continuation lines until we see one with a date.
    while start < len(lines) and not re.search(r"\d{2}/\d{2}/\d{4}", lines[start]):
        start += 1

    end = len(lines)
    for j in range(start, len(lines)):
        stripped = lines[j].strip()
        if any(stripped.startswith(m) for m in END_MARKERS):
            end = j
            break
    return start, end


def _group_blocks(lines: list[str]) -> list[list[str]]:
    """Group region lines into transaction blocks anchored by LINE_ANCHOR matches."""
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in lines:
        if not line.strip():
            continue
        if LINE_ANCHOR.match(line.strip()):
            if current:
                blocks.append(current)
            current = [line]
        elif current:
            current.append(line)
        # discard lines before the first anchor
    if current:
        blocks.append(current)
    return blocks


def _parse_block(block: list[str]) -> _ParsedTrade | None:
    anchor_line = block[0].strip()
    m = LINE_ANCHOR.match(anchor_line)
    if not m:
        return None

    head = m.group("head")
    tx = m.group("tx")
    date1 = m.group("date1")
    date2 = m.group("date2")
    spousal_prefix = m.group("spousal") or ""
    amount_start = m.group("amount_start")
    amount_end = m.group("amount_end")
    over_needs_amount = amount_start.strip().lower() == "over"

    asset_continuation: list[str] = []
    for cont_line in block[1:]:
        cont_s = cont_line.strip()
        if not cont_s:
            continue
        if METADATA_RE.match(cont_s):
            break

        # Case 1: bare "Over" on the anchor line — pull $X from the continuation.
        if over_needs_amount:
            m_amt = AMOUNT_TAIL_RE.search(cont_s)
            if m_amt:
                amount_start = f"Over ${m_amt.group(1)}"
                asset_part = cont_s[: m_amt.start()].strip()
                over_needs_amount = False
                if asset_part:
                    asset_continuation.append(asset_part)
                continue

        # Case 2: standard range with wrapped high amount.
        if amount_end is None and not amount_start.lower().startswith("over"):
            m_end = AMOUNT_TAIL_RE.search(cont_s)
            if m_end:
                amount_end = "$" + m_end.group(1)
                asset_part = cont_s[: m_end.start()].strip()
                if asset_part:
                    asset_continuation.append(asset_part)
                continue

        asset_continuation.append(cont_s)

    amount_raw = (spousal_prefix + amount_start).strip()
    if amount_end:
        amount_raw = f"{amount_raw} - {amount_end}"

    owner, asset_head = _split_owner(head)
    full_asset = (asset_head + " " + " ".join(asset_continuation)).strip()
    asset_name, ticker, asset_type = _extract_ticker_and_type(full_asset)
    amount_low, amount_high = _parse_amount_bounds(amount_raw)

    return _ParsedTrade(
        owner=owner,
        asset_name=asset_name,
        asset_ticker=ticker,
        asset_type=asset_type,
        transaction_type=tx,
        transaction_date=_parse_date(date1),
        notification_date=_parse_date(date2),
        amount_range_low=amount_low,
        amount_range_high=amount_high,
        amount_range_raw=amount_raw,
    )


def parse_text(text: str) -> list[_ParsedTrade]:
    lines = text.split("\n")
    region = _find_transaction_region(lines)
    if region is None:
        return []
    start, end = region
    blocks = _group_blocks(lines[start:end])
    return [t for t in (_parse_block(b) for b in blocks) if t is not None]


def _ocr_fallback(pdf_path: Path, doc_id: str) -> tuple[list[TradeRecord], str]:
    """Vision OCR for an image-only scan. Falls back to 'scanned' if unavailable."""
    from congressional.ocr import extract_trades, ocr_enabled

    if not ocr_enabled():
        return [], "scanned"
    try:
        records = extract_trades(pdf_path, doc_id)
    except Exception:
        logger.exception("OCR fallback failed for %s", doc_id)
        return [], "scanned"
    return (records, "ocr_parsed") if records else ([], "ocr_no_transactions")


def parse_ptr(pdf_path: Path, doc_id: str) -> tuple[list[TradeRecord], str]:
    """Parse a PTR PDF and return (trade records, status).

    Status is one of: 'parsed' (read from the text layer), 'ocr_parsed' /
    'ocr_no_transactions' (image-only scan run through the vision fallback),
    'scanned' (image-only with OCR disabled or failed), or 'no_transactions'.
    """
    text = extract_full_text(pdf_path)
    if is_scanned(text):
        return _ocr_fallback(pdf_path, doc_id)

    parsed = parse_text(text)
    if not parsed:
        return [], "no_transactions"

    records: list[TradeRecord] = []
    for i, t in enumerate(parsed, start=1):
        records.append(
            TradeRecord(
                doc_id=doc_id,
                line_number=i,
                owner=t.owner,
                asset_name=t.asset_name,
                asset_ticker=t.asset_ticker,
                asset_type=t.asset_type,
                transaction_type=t.transaction_type,
                transaction_date=t.transaction_date,
                notification_date=t.notification_date,
                amount_range_low=t.amount_range_low,
                amount_range_high=t.amount_range_high,
                amount_range_raw=t.amount_range_raw,
            )
        )
    return records, "parsed"
