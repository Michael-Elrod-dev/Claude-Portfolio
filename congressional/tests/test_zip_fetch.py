from pathlib import Path

from congressional.house.zip_fetch import extract_house_zip


def test_extract_returns_xml_path(sample_zip_path: Path, tmp_path: Path):
    extract_dir = tmp_path / "extracted"
    xml_path = extract_house_zip(sample_zip_path, extract_dir)
    assert xml_path.exists()
    assert xml_path.name == "2024FD.xml"
    assert xml_path.parent == extract_dir


def test_extract_falls_back_to_any_xml(tmp_path: Path):
    import io
    import zipfile

    zip_path = tmp_path / "weirdly_named.zip"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("some_other_name.xml", "<FinancialDisclosure></FinancialDisclosure>")
    zip_path.write_bytes(buf.getvalue())

    xml_path = extract_house_zip(zip_path, tmp_path / "out")
    assert xml_path.name == "some_other_name.xml"
