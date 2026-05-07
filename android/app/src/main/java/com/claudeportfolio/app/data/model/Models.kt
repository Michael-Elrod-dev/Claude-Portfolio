package com.claudeportfolio.app.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// Wire shapes that the Android app reads. These mirror the JSON returned
// by the API Lambda (see api/routes/). All annotated with @Serializable so
// Retrofit + the kotlinx-serialization converter can deserialize directly.
//
// Field names match the API exactly. Don't rename without updating the API.

// ── Portfolio ────────────────────────────────────────────────────────────

@Serializable
data class Portfolio(
    val asOf: String,
    val account: Account,
    val positions: Positions,
)

@Serializable
data class Account(
    val portfolioValue: Double,
    val cash: Double,
    val buyingPower: Double,
    val costBasis: Double? = null,
    val equity: Double,
    val lastEquity: Double,
    val dayPl: Double,
    val dayPlPct: Double,
    val monthPl: Double? = null,
    val monthPlPct: Double? = null,
    val yearPl: Double? = null,
    val yearPlPct: Double? = null,
    val totalPl: Double? = null,
    val totalPlPct: Double? = null,
)

@Serializable
data class Positions(
    val count: Int,
    val totalCostBasis: Double,
    val totalMarketValue: Double,
    val totalUnrealizedPl: Double,
    val holdings: List<Position>,
)

@Serializable
data class Position(
    val symbol: String,
    val qty: Double,
    val avgEntryPrice: Double,
    val currentPrice: Double,
    val marketValue: Double,
    val costBasis: Double,
    val unrealizedPl: Double,
    val unrealizedPlPct: Double,
    val dayPl: Double? = null,
    val dayPlPct: Double? = null,
    val opened: String? = null,
    val thesis: String? = null,
)

// ── Memo ─────────────────────────────────────────────────────────────────

@Serializable
data class Memo(
    val lastUpdated: String? = null,
    val openTheses: List<OpenThesis> = emptyList(),
    val closedTheses: List<ClosedThesis> = emptyList(),
    val watchlist: List<String> = emptyList(),
    val generalObservations: String = "",
)

@Serializable
data class OpenThesis(
    val ticker: String,
    val thesis: String,
    val openedRun: String,
    val watchFor: List<String> = emptyList(),
)

@Serializable
data class ClosedThesis(
    val ticker: String,
    val thesis: String,
    val closedRun: String,
    val outcome: String,
)

// ── Runs ─────────────────────────────────────────────────────────────────

@Serializable
data class RunSummary(
    val runDate: String,
    val timestamp: String,
    val durationSec: Int,
    val dryRun: Boolean,
    val forced: Boolean,
    val summary: String? = null,
    val analystMeta: AnalystMeta = AnalystMeta(),
    val recommendations: List<Recommendation> = emptyList(),
    val executor: ExecutorTally,
    val briefingErrors: List<BriefingError> = emptyList(),
    /**
     * Real API embeds the full briefing JSON in the run record so the
     * inspector is just a projection. Mock data leaves it null.
     */
    val briefing: JsonObject? = null,
)

@Serializable
data class AnalystMeta(
    val model: String? = null,
    val stopReason: String? = null,
    val webSearchesUsed: Int? = null,
    val inputTokens: Int? = null,
    val outputTokens: Int? = null,
)

@Serializable
data class Recommendation(
    val action: String,
    val ticker: String,
    val amount: Amount,
    val rationale: String,
    val confidence: String,
    val linkedThesis: String? = null,
    val status: String,
    val orderId: String? = null,
    val sizing: Sizing? = null,
)

@Serializable
data class Amount(
    val type: String,
    val value: Double,
)

@Serializable
data class Sizing(
    val kind: String,
    val value: Double? = null,
    val message: String? = null,
)

@Serializable
data class ExecutorTally(
    val total: Int,
    val executed: Int,
    val queuedForReview: Int = 0,
    val skipped: Int,
    val failed: Int,
    val dryRun: Int,
    val alreadySubmitted: Int = 0,
)

@Serializable
data class BriefingError(
    val source: String,
    val message: String,
)

/** Compact run-list row used by GET /runs?limit=N. */
@Serializable
data class RunListItem(
    val runDate: String,
    val timestamp: String,
    val durationSec: Int,
    val dryRun: Boolean,
    val forced: Boolean,
    val summary: String? = null,
    val recCount: Int,
    val executor: ExecutorTally,
    val briefingErrors: List<BriefingError> = emptyList(),
    /** Day P/L percent for the row's right-hand column. Often null. */
    val dayPlPct: Double? = null,
)

// ── Briefing inspector ──────────────────────────────────────────────────

@Serializable
data class BriefingPayload(
    val runDate: String,
    val briefing: JsonObject,
)

// ── Activity feed ───────────────────────────────────────────────────────

@Serializable
data class ActivityEvent(
    val timestamp: String,
    val kind: String,
    val payload: JsonObject = JsonObject(emptyMap()),
)

// ── Flags ───────────────────────────────────────────────────────────────

@Serializable
data class Flag(val name: String, val value: Boolean)
