import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from congressional import ocr
from congressional.db import Filing, PTRParse, Trade, make_engine, upsert
from congressional.models import sanitize_trade_dates
from congressional.senate.client import SenateClient
from congressional.senate.html_parser import parse_ptr_html

logger = logging.getLogger(__name__)

# Senate paper filings render as scanned GIF pages on the public media CDN,
# embedded in the viewer HTML.
_SCAN_IMG_RE = re.compile(r'<img[^>]+src="(https://efd-media-public\.senate\.gov/[^"]+)"')


def _fetch_paper_images(client: SenateClient, source_url: str) -> list[tuple[bytes, str]]:
    """Pull the scanned page images out of a Senate paper-filing viewer page."""
    view_path = "/" + source_url.split("/", 3)[-1]
    html = client.get(view_path).text
    images: list[tuple[bytes, str]] = []
    for url in _SCAN_IMG_RE.findall(html)[: ocr.MAX_PAGES]:
        resp = client.get(url)
        media_type = resp.headers.get("content-type", "image/gif").split(";")[0].strip()
        images.append((resp.content, media_type))
    return images


@dataclass
class SenateParsePTRsResult:
    year: int
    total_ptrs: int
    attempted: int
    parsed: int
    paper_skipped: int
    no_transactions: int
    errors: int
    trades_inserted: int
    error_samples: list[tuple[str, str]] = field(default_factory=list)


def _html_cache_path(data_dir: Path, year: int, doc_id: str) -> Path:
    return data_dir / "senate" / "ptrs" / str(year) / f"{doc_id}.html"


def parse_ptrs_for_year(
    year: int,
    data_dir: Path,
    *,
    limit: int | None = None,
    skip_already_done: bool = True,
    retry_paper: bool = False,
) -> SenateParsePTRsResult:
    db_path = data_dir / "congressional.db"
    engine = make_engine(db_path)

    with Session(engine) as session:
        stmt = select(Filing.doc_id, Filing.source_url).where(
            Filing.filing_year == year,
            Filing.chamber == "S",
            Filing.filing_type == "P",
        )
        all_ptrs: list[tuple[str, str]] = list(session.execute(stmt).all())

        if retry_paper:
            # Re-attempt only filings previously flagged 'paper' (scanned), now
            # that the OCR fallback exists. They carry no trades — no duplication.
            paper = set(
                session.scalars(select(PTRParse.doc_id).where(PTRParse.status == "paper")).all()
            )
            todo = [(d, u) for d, u in all_ptrs if d in paper]
        elif skip_already_done:
            done = set(session.scalars(select(PTRParse.doc_id)).all())
            todo = [(d, u) for d, u in all_ptrs if d not in done]
        else:
            todo = list(all_ptrs)

    if limit is not None:
        todo = todo[:limit]

    result = SenateParsePTRsResult(
        year=year,
        total_ptrs=len(all_ptrs),
        attempted=len(todo),
        parsed=0,
        paper_skipped=0,
        no_transactions=0,
        errors=0,
        trades_inserted=0,
    )

    if not todo:
        return result

    with SenateClient() as client:
        for doc_id, source_url in todo:
            status = "error"
            error_message: str | None = None
            trade_dicts: list[dict] = []

            try:
                if "/paper/" in source_url:
                    # Image-only paper filing: OCR its scanned pages if enabled.
                    if ocr.ocr_enabled():
                        images = _fetch_paper_images(client, source_url)
                        if images:
                            records = ocr.extract_from_images(images, doc_id)
                            trade_dicts = [r.model_dump() for r in records]
                            status = "ocr_parsed" if trade_dicts else "ocr_no_transactions"
                        else:
                            status = "paper"
                    else:
                        status = "paper"
                else:
                    cache_path = _html_cache_path(data_dir, year, doc_id)
                    if not cache_path.exists():
                        path = "/" + source_url.split("/", 3)[-1]
                        html = client.get(path).text
                        cache_path.parent.mkdir(parents=True, exist_ok=True)
                        cache_path.write_text(html, encoding="utf-8")
                    else:
                        html = cache_path.read_text(encoding="utf-8")

                    records = parse_ptr_html(html, doc_id)
                    trade_dicts = [r.model_dump() for r in records]
                    status = "parsed" if trade_dicts else "no_transactions"
            except Exception as e:
                error_message = f"{type(e).__name__}: {e}"
                if len(result.error_samples) < 5:
                    result.error_samples.append((doc_id, error_message))

            now = datetime.utcnow()
            if trade_dicts:
                dropped = sanitize_trade_dates(trade_dicts, year, now.date())
                if dropped:
                    logger.warning(
                        "doc %s: nulled %d implausible transaction_date(s)", doc_id, dropped
                    )
            with Session(engine) as session:
                if trade_dicts:
                    session.execute(insert(Trade).values(trade_dicts))

                session.execute(
                    upsert(PTRParse, engine)
                    .values(
                        doc_id=doc_id,
                        status=status,
                        trade_count=len(trade_dicts),
                        error_message=error_message,
                        parsed_at=now,
                    )
                    .on_conflict_do_update(
                        index_elements=["doc_id"],
                        set_={
                            "status": status,
                            "trade_count": len(trade_dicts),
                            "error_message": error_message,
                            "parsed_at": now,
                        },
                    )
                )
                session.commit()

            if status in ("parsed", "ocr_parsed"):
                result.parsed += 1
                result.trades_inserted += len(trade_dicts)
            elif status == "paper":
                result.paper_skipped += 1
            elif status in ("no_transactions", "ocr_no_transactions"):
                result.no_transactions += 1
            else:
                result.errors += 1

    return result
