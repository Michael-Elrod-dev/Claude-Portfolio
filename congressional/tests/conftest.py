"""Shared fixtures for the parser tests: sample House XML/ZIP payloads."""

import io
import zipfile
from pathlib import Path

import pytest

SAMPLE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<FinancialDisclosure>
  <Member>
    <Prefix>Hon.</Prefix>
    <Last>Smith</Last>
    <First>Jane</First>
    <Suffix></Suffix>
    <FilingType>P</FilingType>
    <StateDst>CA01</StateDst>
    <Year>2024</Year>
    <FilingDate>1/15/2024</FilingDate>
    <DocID>20012345</DocID>
  </Member>
  <Member>
    <Prefix></Prefix>
    <Last>Doe</Last>
    <First>John</First>
    <Suffix>Jr.</Suffix>
    <FilingType>A</FilingType>
    <StateDst>TX22</StateDst>
    <Year>2024</Year>
    <FilingDate>5/12/2024</FilingDate>
    <DocID>10067890</DocID>
  </Member>
  <Member>
    <Prefix></Prefix>
    <Last>Withdrawn</Last>
    <First>Alex</First>
    <Suffix></Suffix>
    <FilingType>W</FilingType>
    <StateDst></StateDst>
    <Year>2024</Year>
    <FilingDate></FilingDate>
    <DocID>8220999</DocID>
  </Member>
  <Member>
    <Prefix></Prefix>
    <Last></Last>
    <First></First>
    <Suffix></Suffix>
    <FilingType>P</FilingType>
    <StateDst>NY10</StateDst>
    <Year>2024</Year>
    <FilingDate>3/3/2024</FilingDate>
    <DocID>20099999</DocID>
  </Member>
</FinancialDisclosure>
"""


@pytest.fixture
def sample_xml_path(tmp_path: Path) -> Path:
    xml_path = tmp_path / "2024FD.xml"
    xml_path.write_text(SAMPLE_XML, encoding="utf-8")
    return xml_path


@pytest.fixture
def sample_zip_path(tmp_path: Path) -> Path:
    zip_path = tmp_path / "2024FD.zip"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("2024FD.xml", SAMPLE_XML)
    zip_path.write_bytes(buf.getvalue())
    return zip_path
