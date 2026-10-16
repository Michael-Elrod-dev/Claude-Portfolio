"""HTTP client for efdsearch.senate.gov.

Handles the agreement-page cookie gate and CSRF token rotation. Stays polite by
sleeping between requests; the search and detail endpoints are not heavily rate
limited but bursting will eventually trip the Senate's WAF.
"""

import re
import time

import httpx

BASE_URL = "https://efdsearch.senate.gov"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9",
}

CSRF_RE = re.compile(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"')


class SenateClient:
    """Lightweight wrapper around httpx.Client with the agreement-page handshake baked in."""

    def __init__(self, *, request_delay: float = 1.0):
        self._client = httpx.Client(
            base_url=BASE_URL,
            headers=DEFAULT_HEADERS,
            timeout=30.0,
            follow_redirects=True,
        )
        self._request_delay = request_delay
        self._last_request_at = 0.0
        self._search_csrf: str | None = None

    def __enter__(self) -> "SenateClient":
        self.accept_agreement()
        return self

    def __exit__(self, *exc) -> None:
        self._client.close()

    def _polite_sleep(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self._request_delay:
            time.sleep(self._request_delay - elapsed)
        self._last_request_at = time.monotonic()

    def accept_agreement(self) -> None:
        """Submit the prohibition-agreement form so subsequent endpoints respond with 200."""
        r1 = self._client.get("/search/home/")
        r1.raise_for_status()
        m = CSRF_RE.search(r1.text)
        if not m:
            raise RuntimeError("Senate agreement page missing CSRF token")
        csrf = m.group(1)

        self._client.post(
            "/search/home/",
            data={"csrfmiddlewaretoken": csrf, "prohibition_agreement": "1"},
            headers={
                "Referer": f"{BASE_URL}/search/home/",
                "Origin": BASE_URL,
            },
        ).raise_for_status()

        # Visit search page to get a fresh CSRF token for the DataTables endpoint.
        r3 = self._client.get("/search/")
        r3.raise_for_status()
        m2 = CSRF_RE.search(r3.text)
        if not m2:
            raise RuntimeError("Senate search page missing CSRF token")
        self._search_csrf = m2.group(1)

    @property
    def search_csrf(self) -> str:
        if self._search_csrf is None:
            raise RuntimeError("Call accept_agreement() before using search_csrf")
        return self._search_csrf

    def search_post(self, payload: dict) -> httpx.Response:
        self._polite_sleep()
        r = self._client.post(
            "/search/report/data/",
            data=payload,
            headers={
                "Referer": f"{BASE_URL}/search/",
                "Origin": BASE_URL,
                "X-Requested-With": "XMLHttpRequest",
                "X-CSRFToken": self.search_csrf,
                "Accept": "application/json, text/javascript, */*; q=0.01",
            },
        )
        r.raise_for_status()
        return r

    def get(self, path: str) -> httpx.Response:
        self._polite_sleep()
        r = self._client.get(path)
        r.raise_for_status()
        return r
