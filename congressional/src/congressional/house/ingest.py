from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from congressional.db import Filing, make_engine, upsert
from congressional.house.xml_parser import parse_xml
from congressional.house.zip_fetch import download_house_zip, extract_house_zip

BATCH_SIZE = 1000


@dataclass
class IngestResult:
    year: int
    zip_path: Path
    xml_path: Path
    db_path: Path
    records_seen: int
    records_inserted: int


def ingest_year(
    year: int,
    data_dir: Path,
    *,
    force_download: bool = False,
    stamp_first_seen: bool = False,
) -> IngestResult:
    """End-to-end ingest of one year of House disclosures.

    Flow: download ZIP -> extract -> parse XML -> upsert into SQLite.
    Idempotent: re-running for the same year skips already-present DocIDs.

    stamp_first_seen: set True when polling, so newly discovered filings record
    when they first appeared. Leave False for historical backfills — those rows
    keep first_seen_at NULL (publish time genuinely unknown).
    """
    zip_dir = data_dir / "house" / "zips"
    extract_dir = data_dir / "house" / "extracted" / str(year)
    db_path = data_dir / "congressional.db"

    zip_path = download_house_zip(year, zip_dir, force=force_download)
    xml_path = extract_house_zip(zip_path, extract_dir)

    engine = make_engine(db_path)

    records_seen = 0
    records_inserted = 0
    batch: list[dict] = []

    def flush() -> int:
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

    for record in parse_xml(xml_path):
        records_seen += 1
        batch.append({**record.model_dump(), "first_seen_at": first_seen})
        if len(batch) >= BATCH_SIZE:
            records_inserted += flush()
            batch.clear()

    records_inserted += flush()

    return IngestResult(
        year=year,
        zip_path=zip_path,
        xml_path=xml_path,
        db_path=db_path,
        records_seen=records_seen,
        records_inserted=records_inserted,
    )
