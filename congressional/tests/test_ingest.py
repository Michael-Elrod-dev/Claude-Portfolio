import shutil
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from congressional.db import Filing, make_engine
from congressional.house.ingest import ingest_year


@pytest.fixture
def fake_zip_dir(sample_zip_path: Path, tmp_path: Path) -> Path:
    """Pre-stage a cached ZIP so ingest_year skips the download path."""
    data_dir = tmp_path / "data"
    zip_dir = data_dir / "house" / "zips"
    zip_dir.mkdir(parents=True)
    shutil.copy(sample_zip_path, zip_dir / "2024FD.zip")
    return data_dir


def test_ingest_year_end_to_end(fake_zip_dir: Path):
    result = ingest_year(2024, fake_zip_dir)
    assert result.records_seen == 3
    assert result.records_inserted == 3
    assert result.db_path.exists()

    engine = make_engine(result.db_path)
    with Session(engine) as session:
        rows = session.query(Filing).all()
    assert len(rows) == 3

    by_doc = {r.doc_id: r for r in rows}
    assert by_doc["20012345"].filing_type == "P"
    assert by_doc["20012345"].chamber == "H"
    assert by_doc["20012345"].source_url.endswith("/ptr-pdfs/2024/20012345.pdf")
    assert by_doc["10067890"].source_url.endswith("/financial-pdfs/2024/10067890.pdf")
    assert by_doc["8220999"].state_district is None


def test_ingest_is_idempotent(fake_zip_dir: Path):
    first = ingest_year(2024, fake_zip_dir)
    second = ingest_year(2024, fake_zip_dir)

    assert first.records_inserted == 3
    assert second.records_seen == 3
    assert second.records_inserted == 0

    engine = make_engine(second.db_path)
    with Session(engine) as session:
        assert session.query(Filing).count() == 3
