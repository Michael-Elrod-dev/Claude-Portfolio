from pathlib import Path

import httpx


def ptr_cache_path(data_dir: Path, year: int, doc_id: str) -> Path:
    return data_dir / "house" / "ptrs" / str(year) / f"{doc_id}.pdf"


def download_ptr(
    pdf_url: str,
    cache_path: Path,
    *,
    client: httpx.Client | None = None,
    force: bool = False,
) -> Path:
    """Download a PTR PDF to `cache_path`, returning the path. Cached on disk."""
    if cache_path.exists() and not force:
        return cache_path

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = cache_path.with_suffix(".pdf.partial")

    own_client = client is None
    if own_client:
        client = httpx.Client(timeout=30.0, follow_redirects=True)

    try:
        with client.stream("GET", pdf_url) as response:
            response.raise_for_status()
            with tmp_path.open("wb") as f:
                for chunk in response.iter_bytes(chunk_size=64 * 1024):
                    f.write(chunk)
    finally:
        if own_client:
            client.close()

    tmp_path.replace(cache_path)
    return cache_path
