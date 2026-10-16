from datetime import date

from congressional.house.xml_parser import _parse_date, _pdf_url, parse_xml


def test_parses_valid_records(sample_xml_path):
    records = list(parse_xml(sample_xml_path))

    # Two complete + one withdrawal (no StateDst), one record with missing First/Last is dropped.
    assert len(records) == 3
    doc_ids = {r.doc_id for r in records}
    assert doc_ids == {"20012345", "10067890", "8220999"}


def test_field_extraction(sample_xml_path):
    records = {r.doc_id: r for r in parse_xml(sample_xml_path)}

    smith = records["20012345"]
    assert smith.prefix == "Hon."
    assert smith.first == "Jane"
    assert smith.last == "Smith"
    assert smith.suffix is None
    assert smith.state_district == "CA01"
    assert smith.filing_type == "P"
    assert smith.filing_year == 2024
    assert smith.filing_date == date(2024, 1, 15)


def test_withdrawal_without_state_district_is_kept(sample_xml_path):
    records = {r.doc_id: r for r in parse_xml(sample_xml_path)}
    withdrawal = records["8220999"]
    assert withdrawal.state_district is None
    assert withdrawal.filing_date is None
    assert withdrawal.filing_type == "W"


def test_record_missing_required_fields_is_dropped(sample_xml_path):
    records = {r.doc_id: r for r in parse_xml(sample_xml_path)}
    assert "20099999" not in records


def test_ptr_url_uses_ptr_pdfs_path():
    url = _pdf_url("P", 2024, "20012345")
    assert url == "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2024/20012345.pdf"


def test_non_ptr_url_uses_financial_pdfs_path():
    for ft in ("A", "C", "O", "T", "W", "X"):
        url = _pdf_url(ft, 2024, "10067890")
        assert (
            url
            == "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2024/10067890.pdf"
        )


def test_parse_date_known_formats():
    assert _parse_date("1/15/2024") == date(2024, 1, 15)
    assert _parse_date("12/31/2023") == date(2023, 12, 31)
    assert _parse_date("2024-05-12") == date(2024, 5, 12)


def test_parse_date_empty_and_invalid():
    assert _parse_date(None) is None
    assert _parse_date("") is None
    assert _parse_date("not a date") is None
