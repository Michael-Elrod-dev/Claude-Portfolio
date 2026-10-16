import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import httpx
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from congressional.db import Filing, PTRParse, Trade, make_engine, upsert
from congressional.house.pdf_fetch import download_ptr, ptr_cache_path
from congressional.house.ptr_parser import parse_ptr
from congressional.models import sanitize_trade_dates

logger = logging.getLogger(__name__)


@dataclass
class ParsePTRsResult:
    year: int
    total_ptrs: int
    attempted: int
    parsed: int
    scanned: int
    no_transactions: int
    errors: int
    trades_inserted: int
    error_samples: list[tuple[str, str]] = field(default_factory=list)


def parse_ptrs_for_year(
    year: int,
    data_dir: Path,
    *,
    limit: int | None = None,
    skip_already_done: bool = True,
    retry_scanned: bool = False,
) -> ParsePTRsResult:
    db_path = data_dir / "congressional.db"
    engine = make_engine(db_path)

    with Session(engine) as session:
        ptr_stmt = select(Filing.doc_id, Filing.source_url).where(
            Filing.filing_year == year,
            Filing.filing_type == "P",
            Filing.chamber == "H",
        )
        all_ptrs: list[tuple[str, str]] = list(session.execute(ptr_stmt).all())

        if retry_scanned:
            # Re-attempt filings flagged image-only ('scanned') OR that OCR'd to
            # zero rows ('ocr_no_transactions' — e.g. the dense 40-56pp scans whose
            # JSON output overflowed the token cap before the batching fix). Both
            # carry no trades yet, so re-parsing can't create duplicates.
            retry_ids = set(
                session.scalars(
                    select(PTRParse.doc_id).where(
                        PTRParse.status.in_(["scanned", "ocr_no_transactions"])
                    )
                ).all()
            )
            todo = [(d, u) for d, u in all_ptrs if d in retry_ids]
        elif skip_already_done:
            done_doc_ids = set(session.scalars(select(PTRParse.doc_id)).all())
            todo = [(d, u) for d, u in all_ptrs if d not in done_doc_ids]
        else:
            todo = list(all_ptrs)

    if limit is not None:
        todo = todo[:limit]

    result = ParsePTRsResult(
        year=year,
        total_ptrs=len(all_ptrs),
        attempted=len(todo),
        parsed=0,
        scanned=0,
        no_transactions=0,
        errors=0,
        trades_inserted=0,
    )

    if not todo:
        return result

    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        for doc_id, pdf_url in todo:
            cache_path = ptr_cache_path(data_dir, year, doc_id)
            status = "error"
            error_message: str | None = None
            trade_dicts: list[dict] = []

            try:
                download_ptr(pdf_url, cache_path, client=client)
                records, parse_status = parse_ptr(cache_path, doc_id)
                trade_dicts = [r.model_dump() for r in records]
                dropped = sanitize_trade_dates(trade_dicts, year, datetime.utcnow().date())
                if dropped:
                    logger.warning(
                        "doc %s: nulled %d implausible transaction_date(s)", doc_id, dropped
                    )
                status = parse_status
            except Exception as e:
                error_message = f"{type(e).__name__}: {e}"
                if len(result.error_samples) < 5:
                    result.error_samples.append((doc_id, error_message))

            now = datetime.utcnow()
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
            elif status == "scanned":
                result.scanned += 1
            elif status in ("no_transactions", "ocr_no_transactions"):
                result.no_transactions += 1
            else:
                result.errors += 1

    return result
