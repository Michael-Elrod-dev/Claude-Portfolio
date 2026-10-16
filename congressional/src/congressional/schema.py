"""Row models for the snapshot the trading bot reads.

Field aliases are the camelCase wire names the bot's CongressionalSource
normalizes (politicianId, assetTicker, lastTraded, ...). Serialize with
`model_dump(mode="json", by_alias=True)` — the field order and names are the
contract, pinned by tests/test_export.py.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Party = Literal["D", "R", "U"]  # 'U' = unknown
Chamber = Literal["House", "Senate"]
TradeKind = Literal["BUY", "SELL"]
OwnerCode = Literal["Self", "Spouse", "Child", "Joint", "Undisclosed"]

class Politician(BaseModel):
    # Canonical, stable identifier: the member's bioguide id (e.g. "M001204"), or a
    # dash-free hash for the unresolved zero-trade tail. THIS is the join key — a
    # trade's `politicianId` equals this exactly, the same way a trade's `issuerId`
    # equals `issuer.id` (the ticker). Join trades → members on this field.
    id: str = Field(
        description=(
            "Canonical member id — the bioguide, e.g. 'M001204'. A trade's "
            "`politicianId` equals this exactly; join trades to members on this field."
        )
    )
    # Human-readable URL slug: "<name>-<id>" (e.g. "daniel-meuser-M001204"). Cosmetic,
    # for links only — the name part can drift, so only the trailing id is
    # authoritative. Do NOT join on this; join on `id`.
    slug: str = Field(
        description=(
            "Human-readable URL slug, '<name>-<id>' (e.g. 'daniel-meuser-M001204'). "
            "For links only — join on `id`, not this."
        )
    )
    name: str
    party: Party
    chamber: Chamber
    state: str
    committee: str
    # Full committee list (the UI shows the first two in `committee`); powers the
    # committee filter's option list.
    committees: list[str] = []
    trades: int
    filings: int = 0
    issuers: int
    volume: float
    gender: Literal["M", "F", "U"] = "U"
    last_traded: str = Field(alias="lastTraded")
    initials: str
    seed: int
    # Official congressional portrait (theunitedstates.io); None when the filer
    # can't be matched to a member (e.g. election candidates).
    photo_url: str | None = Field(default=None, alias="photoUrl")

    model_config = {"populate_by_name": True}


class TradeDateLabel(BaseModel):
    day: int
    month: str
    year: str
    # Full ISO-8601 UTC timestamp of when the poller first saw the filing, or
    # None for backfilled rows (publish time genuinely unknown).
    time: str | None = None


class TradeTradedAt(BaseModel):
    day: int
    month: str
    year: str


class Trade(BaseModel):
    id: str
    politician_id: str = Field(alias="politicianId")
    # None for non-ticker assets (Treasuries, bonds, funds, private LLCs);
    # consumers fall back to the asset name.
    issuer_id: str | None = Field(default=None, alias="issuerId")
    # The disclosed asset: name always present; ticker None for non-equities;
    # class is one of stocks | bonds | funds | other (classified in /trades).
    asset_name: str = Field(alias="assetName")
    asset_ticker: str | None = Field(default=None, alias="assetTicker")
    asset_class: str = Field(alias="assetClass")
    published: TradeDateLabel
    traded: TradeTradedAt
    filed_after: int = Field(alias="filedAfter")
    owner: OwnerCode
    type: TradeKind
    flagged: bool
    size_label: str = Field(alias="sizeLabel")
    # The filing's verbatim amount string (e.g. "$1,000,001 - $5,000,000" or
    # an exact dollar figure); None when the filing carried no raw string.
    size_exact: str | None = Field(default=None, alias="sizeExact")
    size_rank: int = Field(alias="sizeRank")
    price: float | None

    model_config = {"populate_by_name": True}


class TradesPage(BaseModel):
    data: list[Trade]
    total: int
    limit: int
    offset: int
