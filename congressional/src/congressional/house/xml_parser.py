import xml.etree.ElementTree as ET
from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path

from congressional.models import FilingRecord

PTR_URL_TEMPLATE = "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{year}/{doc_id}.pdf"
OTHER_URL_TEMPLATE = (
    "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{year}/{doc_id}.pdf"
)


def _text(elem: ET.Element, tag: str) -> str | None:
    child = elem.find(tag)
    if child is None or child.text is None:
        return None
    stripped = child.text.strip()
    return stripped or None


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _pdf_url(filing_type: str, year: int, doc_id: str) -> str:
    template = PTR_URL_TEMPLATE if filing_type == "P" else OTHER_URL_TEMPLATE
    return template.format(year=year, doc_id=doc_id)


def parse_xml(xml_path: Path) -> Iterator[FilingRecord]:
    """Stream FilingRecord objects from a House `{YEAR}FD.xml` file."""
    # S314: input is a trusted House gov source fetched over HTTPS, and streaming
    # iterparse is needed for the large FD.xml files.
    for _, member in ET.iterparse(xml_path, events=("end",)):  # noqa: S314
        if member.tag != "Member":
            continue

        doc_id = _text(member, "DocID")
        first = _text(member, "First")
        last = _text(member, "Last")
        filing_type = _text(member, "FilingType")
        year_str = _text(member, "Year")

        if doc_id and first and last and filing_type and year_str:
            try:
                year = int(year_str)
            except ValueError:
                member.clear()
                continue

            yield FilingRecord(
                doc_id=doc_id,
                chamber="H",
                prefix=_text(member, "Prefix"),
                first=first,
                last=last,
                suffix=_text(member, "Suffix"),
                state_district=_text(member, "StateDst"),
                filing_type=filing_type,
                filing_year=year,
                filing_date=_parse_date(_text(member, "FilingDate")),
                source_url=_pdf_url(filing_type, year, doc_id),
            )

        member.clear()
