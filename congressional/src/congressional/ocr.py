"""Vision-LLM fallback for scanned / image-only PTR filings.

Most Periodic Transaction Reports are born-digital PDFs whose text layer is read
directly (house.ptr_parser / senate.html_parser). A steady ~12% are image-only
scans with no text — `is_scanned()` flags those. This module renders those pages
to images and uses Claude (vision) to extract the same transaction fields, then
**validates** every row against the known PTR amount brackets and transaction
codes before the data is trusted — a confidently-wrong amount from OCR is worse
than a dropped one, so unverifiable values are nulled rather than guessed.

Disabled (no-op) unless ANTHROPIC_API_KEY is set; callers fall back to flagging
the filing "scanned" exactly as before.
"""

import base64
import json
import logging
import os
import re
from datetime import date, datetime
from pathlib import Path

from congressional.models import TradeRecord

logger = logging.getLogger(__name__)

# Claude Sonnet 5 — strong table-vision at a price that's negligible for the
# ~70-90 scanned filings/year this handles (a few $ one-time, pennies ongoing).
OCR_MODEL = "claude-sonnet-5"
RENDER_DPI = 150  # plenty for these forms; higher just costs more tokens
MAX_PAGES = 60  # brokerage-attached PTRs (e.g. Khanna) run 40-56 pages
MAX_TOKENS = 16000  # headroom per batch so a dense reply doesn't truncate
PAGES_PER_BATCH = 4  # OCR a few pages per call: one call can't emit all the
# transactions from a 50-page filing without overflowing
# its token budget and truncating the JSON — that bug
# silently dropped every Khanna/McCaul filing to 0 rows.

# The fixed STOCK Act amount brackets — lower bound of each. An OCR'd amount must
# land exactly on one of these or we don't trust it (misread digits won't).
VALID_BRACKET_LOWS: set[int] = {
    1001,
    15001,
    50001,
    100001,
    250001,
    500001,
    1000001,
    5000001,
    25000001,
    50000001,
}
_VALID_OWNERS = {"SP", "DC", "JT"}

_SYSTEM = (
    "You extract transactions from U.S. congressional Periodic Transaction Report "
    "(PTR) disclosure forms. The input is a scanned image of a filing. Read only the "
    "transaction table; transcribe exactly what is written and never invent values."
)

_PROMPT = """Extract every transaction row from this PTR filing. Respond with ONLY a JSON object of exactly this shape — no prose, no markdown fences:

{"transactions": [
  {
    "owner": "SP | DC | JT | null",
    "asset_name": "string",
    "asset_ticker": "string | null",
    "transaction_type": "P | S | E",
    "transaction_date": "YYYY-MM-DD | null",
    "notification_date": "YYYY-MM-DD | null",
    "amount_low": <integer | null>,
    "amount_high": <integer | null>
  }
]}

Rules:
- Include only actual rows from the transaction table. Ignore headers, totals, asset-class-detail footnotes, and any non-transaction section.
- The blank PTR form has a pre-printed EXAMPLE row — typically "Example: Mega Corp. Common Stock" with placeholder dates/amounts. NEVER include it. If the form says "Nothing to report", return {"transactions": []}.
- owner: the ownership code if shown — Spouse=SP, Dependent Child=DC, Joint=JT — else null (filer's own holding).
- transaction_type: P for purchase/buy, S for sale/sell, E for exchange.
- asset_ticker: the stock symbol in parentheses if present (e.g. "(NVDA)" -> "NVDA"), else null.
- amount_* are the fixed disclosure brackets in whole dollars: e.g. "$1,001 - $15,000" -> amount_low 1001, amount_high 15000. For "Over $50,000,000" use amount_low 50000001, amount_high null.
- If any value is illegible or absent, use null. Do not guess.
- If there is no transaction table (e.g. a cover page only), return {"transactions": []}."""


def ocr_enabled() -> bool:
    """True when an Anthropic key is configured, so the vision fallback can run."""
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _render_pages(pdf_path: Path) -> list[bytes]:
    import fitz  # pymupdf — lazy import so the dep is only needed for scans

    images: list[bytes] = []
    with fitz.open(pdf_path) as doc:
        for page in list(doc)[:MAX_PAGES]:
            pix = page.get_pixmap(dpi=RENDER_DPI)
            images.append(pix.tobytes("png"))
    return images


def _extract_json(text: str) -> dict:
    """Pull the JSON object out of the model's reply, tolerating stray fences."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return {}
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        pass
    # Salvage a truncated reply: each transaction is a flat {...} object, so
    # recover the complete ones even if the array was cut off mid-write.
    salvaged = []
    for obj in re.findall(r"\{[^{}]*\}", text[start:]):
        try:
            salvaged.append(json.loads(obj))
        except json.JSONDecodeError:
            continue
    return {"transactions": salvaged} if salvaged else {}


def _parse_date(value) -> date | None:
    if not value or not isinstance(value, str):
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _normalize_type(value) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    head = value.strip()[0].upper()
    return head if head in {"P", "S", "E"} else None


def _row_to_record(row: dict, doc_id: str, line_number: int) -> TradeRecord | None:
    asset_name = row.get("asset_name")
    if not isinstance(asset_name, str) or not asset_name.strip():
        return None
    name = asset_name.strip()
    # Belt-and-suspenders against the blank form's pre-printed example row.
    if name.lower().startswith("example") or "mega corp" in name.lower():
        return None
    tx = _normalize_type(row.get("transaction_type"))
    if tx is None:
        return None  # can't classify the row — drop rather than store a guess

    # Trust an amount only if its low bound is an exact disclosure bracket.
    low = row.get("amount_low")
    high = row.get("amount_high")
    if not (isinstance(low, int) and low in VALID_BRACKET_LOWS):
        low = high = None
    elif not isinstance(high, int):
        high = None
    raw = None
    if low is not None:
        raw = f"${low:,} - ${high:,}" if high is not None else f"Over ${low - 1:,}"

    owner = row.get("owner")
    owner = owner if owner in _VALID_OWNERS else None
    ticker = row.get("asset_ticker")
    ticker = ticker.strip().upper() if isinstance(ticker, str) and ticker.strip() else None

    return TradeRecord(
        doc_id=doc_id,
        line_number=line_number,
        owner=owner,
        asset_name=asset_name.strip(),
        asset_ticker=ticker,
        asset_type=None,
        transaction_type=tx,
        transaction_date=_parse_date(row.get("transaction_date")),
        notification_date=_parse_date(row.get("notification_date")),
        amount_range_low=low,
        amount_range_high=high,
        amount_range_raw=raw,
    )


def _ocr_call(image_content: list[dict], doc_id: str) -> list:
    """One vision call on a batch of page-image content blocks -> raw row dicts."""
    import anthropic

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment
    resp = client.messages.create(
        model=OCR_MODEL,
        max_tokens=MAX_TOKENS,
        system=_SYSTEM,
        messages=[{"role": "user", "content": [*image_content, {"type": "text", "text": _PROMPT}]}],
    )
    if resp.stop_reason == "refusal":
        logger.warning("OCR refused for %s", doc_id)
        return []
    reply = next((b.text for b in resp.content if b.type == "text"), "")
    rows = _extract_json(reply).get("transactions", [])
    return rows if isinstance(rows, list) else []


def extract_from_images(images: list[tuple[bytes, str]], doc_id: str) -> list[TradeRecord]:
    """OCR pre-fetched page images into validated TradeRecords (empty on failure).

    `images` is a list of (raw bytes, media_type) — ("image/png") for House PDF
    renders or ("image/gif") for the Senate paper-filing scans. Pages are OCR'd in
    small batches: one call can't emit all the transactions from a long (40-56pp)
    brokerage-attached filing without overflowing its token budget and truncating
    the JSON, which silently lost every such filing (Khanna, McCaul). Batching
    keeps each reply parseable.
    """
    images = images[:MAX_PAGES]
    if not images:
        return []

    records: list[TradeRecord] = []
    line = 1
    for start in range(0, len(images), PAGES_PER_BATCH):
        content = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": base64.standard_b64encode(data).decode(),
                },
            }
            for data, media_type in images[start : start + PAGES_PER_BATCH]
        ]
        for row in _ocr_call(content, doc_id):
            if isinstance(row, dict):
                rec = _row_to_record(row, doc_id, line)
                if rec is not None:
                    records.append(rec)
                    line += 1
    return records


def extract_trades(pdf_path: Path, doc_id: str) -> list[TradeRecord]:
    """OCR an image-only PTR PDF (House path): render pages, then run the model."""
    images = [(png, "image/png") for png in _render_pages(pdf_path)]
    return extract_from_images(images, doc_id)
