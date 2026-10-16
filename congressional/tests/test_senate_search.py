from datetime import date

from congressional.senate.search import _parse_row


def test_parse_row_e_file_ptr():
    row = [
        "Markwayne",
        "Mullin",
        "Mullin, Markwayne (Senator)",
        '<a href="/search/view/ptr/502805c9-fddf-417d-a07a-21e01f76767f/" '
        'target="_blank">Periodic Transaction Report for 12/31/2024</a>',
        "12/31/2024",
    ]
    rec = _parse_row(row)
    assert rec is not None
    assert rec.chamber == "S"
    assert rec.doc_id == "502805c9-fddf-417d-a07a-21e01f76767f"
    assert rec.first == "Markwayne"
    assert rec.last == "Mullin"
    assert rec.filing_type == "P"
    assert rec.filing_year == 2024
    assert rec.filing_date == date(2024, 12, 31)
    assert rec.source_url.endswith("/search/view/ptr/502805c9-fddf-417d-a07a-21e01f76767f/")


def test_parse_row_paper_ptr_uses_paper_path():
    row = [
        "RICHARD",
        "BLUMENTHAL",
        "Senator",
        '<a href="/search/view/paper/7d8d619e-cbcb-4fec-9146-d4bbd7b87c3a/" '
        'target="_blank">Periodic Transaction Report for 12/31/2024</a>',
        "12/31/2024",
    ]
    rec = _parse_row(row)
    assert rec is not None
    assert rec.doc_id == "7d8d619e-cbcb-4fec-9146-d4bbd7b87c3a"
    assert "/paper/" in rec.source_url


def test_parse_row_missing_link_returns_none():
    row = ["First", "Last", "Senator", "no link here", "12/31/2024"]
    assert _parse_row(row) is None


def test_parse_row_bad_date_returns_none():
    row = [
        "First",
        "Last",
        "Senator",
        '<a href="/search/view/ptr/abc-123/">PTR</a>',
        "not-a-date",
    ]
    assert _parse_row(row) is None
