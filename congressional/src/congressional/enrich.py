"""Small lookups for filers the legislators dataset can't resolve.

Disclosure filings carry a name and a chamber/district but not party, so
members are resolved against the congress-legislators dataset (see
legislators.py / enrich_filers.py). This module holds the fallbacks:

- a hand-curated party table keyed by (last_name, chamber, state_prefix);
  unknowns return 'U';
- a Senate last-name -> state table (Senate filings carry no district);
- `ticker_seed` / `initials_of`, deterministic per-member display values the
  snapshot's politician rows include.
"""

from __future__ import annotations

import re
from typing import Literal

Party = Literal["D", "R", "U"]
# ---- Party lookup ----------------------------------------------------------
#
# Key: (last_name_lower_no_punct, chamber, state_prefix_or_None)
#   - chamber 'H' or 'S'
#   - state_prefix is the two-letter state derived from state_district[:2];
#     for Senate filers (no state in our DB) we leave it None.
#
# Source: public roster knowledge as of 2024. Curated for our active filers.

_PARTY_TABLE: dict[tuple[str, str, str | None], Party] = {
    # ---- House (top 2024 filers) ----
    ("gottheimer", "H", "NJ"): "D",
    ("james", "H", "MI"): "R",
    ("moskowitz", "H", "FL"): "D",
    ("manning", "H", "NC"): "D",
    ("greene", "H", "GA"): "R",
    ("landsman", "H", "OH"): "D",
    ("franklin", "H", "FL"): "R",
    ("hern", "H", "OK"): "R",
    ("blumenauer", "H", "OR"): "D",
    ("foxx", "H", "NC"): "R",
    ("peters", "H", "CA"): "D",
    ("keating", "H", "MA"): "D",
    ("jackson", "H", "IL"): "D",
    ("moore", "H", "UT"): "R",
    ("burgess", "H", "TX"): "R",
    ("delbene", "H", "WA"): "D",
    ("kean", "H", "NJ"): "R",
    ("newhouse", "H", "WA"): "R",
    ("kelly", "H", "PA"): "R",
    ("trone", "H", "MD"): "D",
    ("thanedar", "H", "MI"): "D",
    ("doggett", "H", "TX"): "D",
    ("allen", "H", "GA"): "R",
    ("sessions", "H", "TX"): "R",
    ("mcgarvey", "H", "KY"): "D",
    ("hill", "H", "AR"): "R",
    ("green", "H", "TN"): "R",
    ("magaziner", "H", "RI"): "D",
    ("rogers", "H", "KY"): "R",
    ("mccaul", "H", "TX"): "R",
    ("khanna", "H", "CA"): "D",
    ("malliotakis", "H", "NY"): "R",
    ("lamborn", "H", "CO"): "R",
    ("donalds", "H", "FL"): "R",
    ("fleischmann", "H", "TN"): "R",
    ("wagner", "H", "MO"): "R",
    ("wied", "H", "WI"): "R",
    ("mast", "H", "FL"): "R",
    ("matsui", "H", "CA"): "D",
    ("miller", "H", "OH"): "R",
    ("luna", "H", "FL"): "R",  # "Anna Paulina Luna"; last token is "Luna"
    ("paulina luna", "H", "FL"): "R",  # alt form in case "last" includes both
    # ---- Senate ----
    ("tuberville", "S", None): "R",
    ("mullin", "S", None): "R",
    ("scott", "S", None): "R",  # Rick Scott (FL); we don't have state for Senate
    ("boozman", "S", None): "R",
    ("moran", "S", None): "R",
    ("capito", "S", None): "R",
    ("fetterman", "S", None): "D",
    ("whitehouse", "S", None): "D",
    ("warner", "S", None): "D",
    ("hickenlooper", "S", None): "D",
    ("peters", "S", None): "D",  # Gary Peters (MI)
    ("hagerty", "S", None): "R",
    ("collins", "S", None): "R",
    ("king", "S", None): "D",  # Angus King caucuses with Dems
    ("graham", "S", None): "R",
    ("smith", "S", None): "D",
    ("mcconnell", "S", None): "R",
    ("coons", "S", None): "D",
    ("wyden", "S", None): "D",
    ("cruz", "S", None): "R",
    ("blumenthal", "S", None): "D",
    ("matsui", "S", None): "D",
}

# Senate state lookup (filers → 2-letter state) since our DB doesn't store it.
_SENATE_STATE: dict[str, str] = {
    "tuberville": "AL",
    "mullin": "OK",
    "scott": "FL",  # disambiguates by being the only senator in our data with this surname
    "boozman": "AR",
    "moran": "KS",
    "capito": "WV",
    "fetterman": "PA",
    "whitehouse": "RI",
    "warner": "VA",
    "hickenlooper": "CO",
    "peters": "MI",
    "hagerty": "TN",
    "collins": "ME",
    "king": "ME",
    "graham": "SC",
    "smith": "MN",
    "mcconnell": "KY",
    "coons": "DE",
    "wyden": "OR",
    "cruz": "TX",
    "blumenthal": "CT",
    "matsui": None,  # actually a House member; shouldn't hit Senate path
}


def _norm_last_name(last: str) -> str:
    """Strip honorifics/punctuation and lowercase the last name."""
    cleaned = re.sub(r"[^a-zA-Z\s]", "", last).strip().lower()
    # Drop common honorific tokens that occasionally appear inline.
    tokens = [t for t in cleaned.split() if t not in {"mr", "mrs", "ms", "dr", "jr", "sr"}]
    return " ".join(tokens) if tokens else cleaned


def lookup_party(last_name: str, chamber: str, state_district: str | None) -> Party:
    """Look up party (D/R) or return 'U' for unknown."""
    last = _norm_last_name(last_name)
    state_prefix = state_district[:2] if state_district else None
    party = _PARTY_TABLE.get((last, chamber, state_prefix))
    if party is not None:
        return party
    # Senate fallback — search by last name only.
    if chamber == "S":
        party = _PARTY_TABLE.get((last, "S", None))
        if party is not None:
            return party
    return "U"


def lookup_senate_state(last_name: str) -> str | None:
    """For Senate filers our DB has no state — fall back to a static lookup."""
    return _SENATE_STATE.get(_norm_last_name(last_name))


# ---- Deterministic synthesis ----------------------------------------------


def ticker_seed(ticker: str) -> int:
    """Stable integer seed derived from the ticker."""
    h = 0
    for ch in ticker:
        h = (h * 131 + ord(ch)) & 0xFFFFFFFF
    return h or 1


def initials_of(first: str, last: str) -> str:
    parts = (first.split() + last.split())[:2]
    return "".join(p[0] for p in parts if p)[:2].upper() or "?"
