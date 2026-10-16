from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from congressional.db import Filing, make_engine, upsert
from congressional.senate.client import SenateClient
from congressional.senate.search import search_ptrs

BATCH_SIZE = 50


@dataclass
class SenateIngestResult:
    year: int
    db_path: Path
    records_seen: int
    records_inserted: int


def ingest_year(
    year: int,
    data_dir: Path,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    stamp_first_seen: bool = False,
) -> SenateIngestResult:
    """Search the Senate site for senator PTRs and persist new filings.

    Pass date_from / date_to to limit the search window for incremental polling.
    Defaults to the full calendar year.

    stamp_first_seen: set True when polling, so newly discovered filings record
    when they first appeared. Leave False for historical backfills — those rows
    keep first_seen_at NULL (publish time genuinely unknown).
    """
    db_path = data_dir / "congressional.db"
    engine = make_engine(db_path)

    seen = 0
    inserted = 0

    def flush(batch: list[dict]) -> int:
        if not batch:
            return 0
        stmt = (
            upsert(Filing, engine).values(batch).on_conflict_do_nothing(index_elements=["doc_id"])
        )
        with Session(engine) as session:
            result = session.execute(stmt)
            session.commit()
        return result.rowcount or 0

    first_seen = datetime.utcnow() if stamp_first_seen else None

    batch: list[dict] = []
    with SenateClient() as client:
        for rec in search_ptrs(client, year=year, date_from=date_from, date_to=date_to):
            seen += 1
            batch.append({**rec.model_dump(), "first_seen_at": first_seen})
            if len(batch) >= BATCH_SIZE:
                inserted += flush(batch)
                batch.clear()
        inserted += flush(batch)

    return SenateIngestResult(
        year=year,
        db_path=db_path,
        records_seen=seen,
        records_inserted=inserted,
    )
