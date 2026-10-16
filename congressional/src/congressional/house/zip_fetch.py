from pathlib import Path

import httpx

HOUSE_ZIP_URL_TEMPLATE = (
    "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{year}FD.zip"
)


def download_house_zip(year: int, dest_dir: Path, *, force: bool = False) -> Path:
    """Download the annual House disclosure ZIP, caching to disk.

    Returns the local path to the cached ZIP. Re-downloads only if `force=True`.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    zip_path = dest_dir / f"{year}FD.zip"
    if zip_path.exists() and not force:
        return zip_path

    url = HOUSE_ZIP_URL_TEMPLATE.format(year=year)
    tmp_path = zip_path.with_suffix(".zip.partial")
    with httpx.stream("GET", url, follow_redirects=True, timeout=60.0) as response:
        response.raise_for_status()
        with tmp_path.open("wb") as f:
            for chunk in response.iter_bytes(chunk_size=64 * 1024):
                f.write(chunk)
    tmp_path.replace(zip_path)
    return zip_path


def extract_house_zip(zip_path: Path, extract_dir: Path) -> Path:
    """Extract the ZIP into `extract_dir` and return the path to the XML index.

    The index file is conventionally named `{year}FD.xml` (matches the ZIP stem).
    """
    import zipfile

    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(extract_dir)

    xml_name = f"{zip_path.stem}.xml"
    xml_path = extract_dir / xml_name
    if not xml_path.exists():
        candidates = list(extract_dir.glob("*.xml"))
        if not candidates:
            raise FileNotFoundError(f"No XML file found in extracted ZIP at {extract_dir}")
        xml_path = candidates[0]
    return xml_path
