package com.claudeportfolio.app.data.api

import com.claudeportfolio.app.data.model.Account
import com.claudeportfolio.app.data.model.ActivityEvent
import com.claudeportfolio.app.data.model.AnalystMeta
import com.claudeportfolio.app.data.model.Amount
import com.claudeportfolio.app.data.model.BriefingError
import com.claudeportfolio.app.data.model.BriefingPayload
import com.claudeportfolio.app.data.model.ClosedThesis
import com.claudeportfolio.app.data.model.ExecutorTally
import com.claudeportfolio.app.data.model.Flag
import com.claudeportfolio.app.data.model.Memo
import com.claudeportfolio.app.data.model.OpenThesis
import com.claudeportfolio.app.data.model.Portfolio
import com.claudeportfolio.app.data.model.Position
import com.claudeportfolio.app.data.model.Positions
import com.claudeportfolio.app.data.model.Recommendation
import com.claudeportfolio.app.data.model.RunListItem
import com.claudeportfolio.app.data.model.RunSummary
import com.claudeportfolio.app.data.model.Sizing
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * In-memory implementation of [PortfolioApi] seeded with the values from
 * the original Claude Design handoff (`data.js`). Used as the fallback
 * when the user hasn't connected the app to the live API yet — every
 * screen still renders so first-launch isn't a blank slate.
 *
 * Phase 5 swaps this for a Retrofit-backed implementation. The interface
 * doesn't change.
 *
 * Mutable bits (active/live flags, registered FCM tokens) are held in
 * memory and reset on process restart — fine for development.
 */
class MockApi : PortfolioApi {

    private var activeFlag = true
    private var liveFlag = false

    override suspend fun getPortfolio(): Portfolio = MOCK_PORTFOLIO

    override suspend fun getMemo(): Memo = MOCK_MEMO

    override suspend fun getRunsLatest(): RunSummary = MOCK_LAST_RUN

    override suspend fun getRunByDate(runDate: String): RunSummary? =
        if (runDate == MOCK_LAST_RUN.runDate) MOCK_LAST_RUN
        // For prior runs we don't have the full RunSummary in the mock —
        // just synthesize a minimal one so the History → Run detail tap works.
        else MOCK_HISTORY.firstOrNull { it.runDate == runDate }?.let(::synthesizeRunFromListItem)

    override suspend fun getRunsList(limit: Int): List<RunListItem> =
        MOCK_HISTORY.take(limit)

    override suspend fun getBriefingLatest(): BriefingPayload =
        BriefingPayload(runDate = MOCK_LAST_RUN.runDate, briefing = MOCK_BRIEFING_JSON)

    override suspend fun getActivity(limit: Int): List<ActivityEvent> =
        MOCK_ACTIVITY.take(limit)

    override suspend fun getFlagActive() = Flag("claude-portfolio-active", activeFlag)

    override suspend fun setFlagActive(value: Boolean): Flag {
        activeFlag = value
        return getFlagActive()
    }

    override suspend fun getFlagLive() = Flag("claude-portfolio-live", liveFlag)

    override suspend fun setFlagLive(value: Boolean): Flag {
        liveFlag = value
        return getFlagLive()
    }

    override suspend fun runForce() { /* no-op for mock */ }

    override suspend fun registerDevice(token: String, platform: String, appVersion: String?) {
        /* no-op */
    }

    private fun synthesizeRunFromListItem(item: RunListItem): RunSummary = RunSummary(
        runDate = item.runDate,
        timestamp = item.timestamp,
        durationSec = item.durationSec,
        dryRun = item.dryRun,
        forced = item.forced,
        summary = item.summary,
        analystMeta = AnalystMeta(
            model = "claude-opus-4-7",
            stopReason = "end_turn",
            webSearchesUsed = null,
            inputTokens = null,
            outputTokens = null,
        ),
        recommendations = emptyList(),
        executor = item.executor,
        briefingErrors = item.briefingErrors,
    )

    companion object {
        // ── Account / portfolio ──────────────────────────────────────────
        private val MOCK_PORTFOLIO = Portfolio(
            asOf = "2026-05-03T22:14:08Z",
            account = Account(
                portfolioValue = 104382.41,
                cash = 8214.62,
                buyingPower = 16429.24,
                equity = 104382.41,
                lastEquity = 102917.06,
                dayPl = 1465.35,
                dayPlPct = 0.01424,
                monthPl = 1814.22,
                monthPlPct = 0.01768,
                yearPl = 5942.10,
                yearPlPct = 0.0599,
                totalPl = 4382.41,
                totalPlPct = 0.0438,
            ),
            positions = Positions(
                count = 7,
                totalCostBasis = 92118.40,
                totalMarketValue = 96167.79,
                totalUnrealizedPl = 4049.39,
                holdings = listOf(
                    Position("NVDA",  18.0, 812.40, 894.12, 16094.16, 14623.20, 1470.96, 0.1006, 142.18, 0.0089, "2026-02-15", "AI capex tailwind"),
                    Position("MSFT",  22.0, 412.80, 438.50,  9647.00,  9081.60,  565.40, 0.0623,  62.04, 0.0065, "2026-01-12", "Hyperscaler + Copilot"),
                    Position("GOOGL", 38.0, 178.20, 184.66,  7017.08,  6771.60,  245.48, 0.0363,  18.24, 0.0026, "2026-01-12", "Search durability + Gemini"),
                    Position("COST",   9.0, 824.10, 846.20,  7615.80,  7416.90,  198.90, 0.0268,   9.81, 0.0013, "2025-11-30", "Membership compounder"),
                    Position("V",     31.0, 281.40, 286.92,  8894.52,  8723.40,  171.12, 0.0196,  14.27, 0.0016, "2025-09-08", "Payments oligopoly"),
                    Position("UNH",   14.0, 502.10, 471.80,  6605.20,  7029.40, -424.20, -0.0603, -82.46, -0.0123, "2026-03-22", "Reform overhang priced in"),
                    Position("TSM",   22.0, 178.40, 188.62,  4149.64,  3924.80,  224.84, 0.0573,  28.16, 0.0068, "2026-02-15", "AI silicon backbone"),
                ),
            ),
        )

        // ── Last run ─────────────────────────────────────────────────────
        private val MOCK_LAST_RUN = RunSummary(
            runDate = "2026-05-03",
            timestamp = "2026-05-03T22:09:11Z",
            durationSec = 174,
            dryRun = true,
            forced = false,
            summary = "Deploying \$5.8k into existing AI-infrastructure theses on the back of strong hyperscaler capex prints. Trimming UNH on continued reform headline drift; opening a starter PANW position from watchlist after Capitol disclosures.",
            analystMeta = AnalystMeta(
                model = "claude-opus-4-7",
                stopReason = "end_turn",
                webSearchesUsed = 11,
                inputTokens = 47218,
                outputTokens = 6804,
            ),
            recommendations = listOf(
                Recommendation(
                    action = "sell", ticker = "UNH",
                    amount = Amount("percent", 50.0),
                    rationale = "Trim half of UNH. Continued political reform headlines are extending the overhang past my original 4-week patience window. Capitol Trades shows three additional bipartisan sales this week. Better to redeploy into higher-conviction theses.",
                    confidence = "medium", linkedThesis = "UNH",
                    status = "dry_run", orderId = null,
                    sizing = Sizing("notional", 3302.60),
                ),
                Recommendation(
                    action = "buy", ticker = "NVDA",
                    amount = Amount("dollars", 1500.0),
                    rationale = "Adding \$1500 to NVDA on confirmation that hyperscaler 2026 capex guides are trending up — MSFT and META both raised on this week's prints. Data-center revenue concentration remains the cleanest expression of the AI infrastructure thesis.",
                    confidence = "high", linkedThesis = "NVDA",
                    status = "dry_run", orderId = null,
                    sizing = Sizing("notional", 1500.0),
                ),
                Recommendation(
                    action = "buy", ticker = "TSM",
                    amount = Amount("dollars", 1200.0),
                    rationale = "Adding \$1200 to TSM. April revenue +21% YoY beats consensus, and the 3nm/2nm ramp is structurally supplying the same capex wave that NVDA captures downstream. Pairs naturally with the NVDA position.",
                    confidence = "high", linkedThesis = "TSM",
                    status = "dry_run", orderId = null,
                    sizing = Sizing("notional", 1200.0),
                ),
                Recommendation(
                    action = "buy", ticker = "PANW",
                    amount = Amount("dollars", 1500.0),
                    rationale = "Opening a \$1500 starter in PANW from watchlist. Two senators disclosed PANW buys in the last 9 days, both >\$50k. Cybersecurity spend remains non-discretionary and platform consolidation continues. Sizing as a starter, not a full position.",
                    confidence = "medium", linkedThesis = null,
                    status = "queued_for_review", orderId = null,
                    sizing = Sizing("notional", 1500.0),
                ),
                Recommendation(
                    action = "buy", ticker = "COST",
                    amount = Amount("dollars", 600.0),
                    rationale = "Topping up COST by \$600. April comps came in at +6.8%, well above consensus. The membership-compounder thesis is intact and I want to lean into the position before the May earnings print on May 28.",
                    confidence = "high", linkedThesis = "COST",
                    status = "dry_run", orderId = null,
                    sizing = Sizing("notional", 600.0),
                ),
            ),
            executor = ExecutorTally(
                total = 5, executed = 0, queuedForReview = 1,
                skipped = 0, failed = 0, dryRun = 4, alreadySubmitted = 0,
            ),
            briefingErrors = emptyList(),
        )

        // ── Run history (compact rows) ───────────────────────────────────
        private val MOCK_HISTORY = listOf(
            RunListItem("2026-05-03", "2026-05-03T22:09:11Z", 174, true, false,
                "Lean into AI infra; trim UNH; open PANW starter.",
                5, ExecutorTally(5, 0, 1, 0, 0, 4, 0), emptyList(), 0.0142),
            RunListItem("2026-04-26", "2026-04-26T22:08:42Z", 161, true, false,
                "Single \$800 add to MSFT after Copilot enterprise tier disclosed; closed AMD partial.",
                2, ExecutorTally(2, 0, 0, 0, 0, 2, 0), emptyList(), -0.0064),
            RunListItem("2026-04-19", "2026-04-19T22:07:55Z", 138, true, false,
                "No actions. Earnings density across watchlist; preserving cash for post-print clarity.",
                0, ExecutorTally(0, 0, 0, 0, 0, 0, 0), emptyList(), 0.0021),
            RunListItem("2026-04-12", "2026-04-12T22:11:03Z", 192, true, false,
                "Rotate from XOM into UNH starter; add to GOOGL and V.",
                4, ExecutorTally(4, 0, 0, 0, 0, 4, 0), emptyList(), 0.0098),
            RunListItem("2026-04-05", "2026-04-05T22:09:30Z", 168, true, false,
                "Add to NVDA and TSM on capex prints; trim XOM by 50%.",
                3, ExecutorTally(3, 0, 0, 0, 0, 3, 0), emptyList(), -0.0034),
            RunListItem("2026-03-29", "2026-03-29T22:10:12Z", 155, true, false,
                "Open small UNH position; deploy idle cash into existing winners.",
                2, ExecutorTally(2, 0, 0, 0, 0, 2, 0), emptyList(), 0.0058),
            RunListItem("2026-03-22", "2026-03-22T22:08:44Z", 142, true, false,
                "Add \$400 to COST; otherwise patient.",
                1, ExecutorTally(1, 0, 0, 0, 0, 1, 0), emptyList(), 0.0019),
            RunListItem("2026-03-15", "2026-03-15T22:11:20Z", 128, true, false,
                "No actions. Sitting on cash through Fed week.",
                0, ExecutorTally(0, 0, 0, 0, 0, 0, 0), emptyList(), -0.0091),
        )

        // ── Memo ─────────────────────────────────────────────────────────
        private val MOCK_MEMO = Memo(
            lastUpdated = "2026-05-03T22:09:08Z",
            openTheses = listOf(
                OpenThesis("NVDA",
                    "Continued AI capex from hyperscalers (MSFT, META, GOOGL, AMZN) drives sustained data-center GPU demand. Cleanest expression of the infra wave.",
                    "2026-02-15",
                    listOf("Hyperscaler 2026 capex guides", "Export-control news", "Blackwell ramp commentary", "Sovereign-AI deal flow")),
                OpenThesis("MSFT",
                    "Hyperscaler share gains plus durable Copilot monetization. Capex spend confirms commitment to AI buildout.",
                    "2026-01-12",
                    listOf("Azure growth bps", "Copilot seat counts", "OpenAI relationship updates")),
                OpenThesis("GOOGL",
                    "Search remains durable even as Gemini and AI overviews evolve the surface. Cloud is accelerating.",
                    "2026-01-12",
                    listOf("Search query trends", "AI overview monetization", "DOJ remedy proposals")),
                OpenThesis("COST",
                    "Membership compounder with structural pricing power. Comp prints continue to outperform; renewal rates >90%.",
                    "2025-11-30",
                    listOf("Monthly comps", "Membership fee hike timing", "May 28 earnings")),
                OpenThesis("V",
                    "Payments-network oligopoly with embedded volume growth and pricing power. Cross-border travel tailwind continues.",
                    "2025-09-08",
                    listOf("Cross-border volume", "Stablecoin rail competition", "Regulatory swipe-fee headlines")),
                OpenThesis("UNH",
                    "Healthcare reform overhang largely priced in at current multiple. Patience until headlines clear.",
                    "2026-03-22",
                    listOf("Reform headline drift", "MA enrollment data", "Q2 earnings tone")),
                OpenThesis("TSM",
                    "AI silicon backbone. 3nm/2nm ramp supplies the same capex wave NVDA captures; geopolitical risk discounted.",
                    "2026-02-15",
                    listOf("Monthly revenue prints", "2nm yield commentary", "Taiwan-policy news")),
            ),
            closedTheses = listOf(
                ClosedThesis("AMD",
                    "Datacenter accelerator share gain story",
                    "2026-04-26",
                    "Closed at +9% — thesis intact but conviction lower vs. NVDA at this stage of the cycle."),
                ClosedThesis("XOM",
                    "Disciplined capex + Permian asset quality",
                    "2026-04-05",
                    "Trimmed and closed at +14% over ~5 months. Redeployed into UNH starter and NVDA add."),
                ClosedThesis("PG",
                    "Defensive staple with pricing power",
                    "2026-02-15",
                    "Closed flat. Better risk/reward in higher-growth names; macro defensive bias was wrong."),
            ),
            watchlist = listOf("PANW", "CRWD", "NOW", "AVGO", "LLY", "CMG"),
            generalObservations = "AI-infrastructure capex remains the dominant earnings tailwind for Q1 prints. Healthcare-services overhang continues to weigh on managed care; closer to a contrarian setup than two months ago. Watching for any Fed reaction-function shift that would disrupt long-duration tech.",
        )

        // ── Briefing JSON (used by the Settings inspector) ──────────────
        private val MOCK_BRIEFING_JSON: JsonObject = buildJsonObject {
            put("generatedAt", "2026-05-03T22:06:18Z")
            put("completedAt", "2026-05-03T22:06:23Z")
            put("symbolsCovered", buildJsonArray {
                listOf("NVDA","MSFT","GOOGL","COST","V","UNH","TSM",
                       "PANW","CRWD","NOW","AVGO","LLY","CMG","AMD","META","AMZN")
                    .forEach { add(it) }
            })
            put("earnings", buildJsonObject {
                put("windowDays", 14)
                put("events", buildJsonArray {
                    addJsonObject { put("symbol", "COST"); put("date", "2026-05-28"); put("time", "after_close") }
                    addJsonObject { put("symbol", "NVDA"); put("date", "2026-05-21"); put("time", "after_close") }
                    addJsonObject { put("symbol", "CRWD"); put("date", "2026-05-29"); put("time", "after_close") }
                    addJsonObject { put("symbol", "PANW"); put("date", "2026-05-19"); put("time", "after_close") }
                })
            })
            put("congressional", buildJsonObject {
                put("windowDays", 14); put("minValue", 15000); put("count", 11)
            })
            put("errors", buildJsonArray { /* empty */ })
        }

        // ── Activity feed ────────────────────────────────────────────────
        private fun txt(s: String): JsonObject = buildJsonObject { put("text", s) }

        private val MOCK_ACTIVITY = listOf(
            ActivityEvent("2026-05-03T22:09:11Z", "run_complete",
                txt("Weekly run complete · 5 recs · dry-run")),
            ActivityEvent("2026-05-03T22:08:44Z", "memo_write",
                txt("Memo updated · +1 thesis (PANW pending)")),
            ActivityEvent("2026-05-03T22:06:18Z", "briefing_complete",
                txt("Briefing assembled · 16 symbols · 0 errors")),
            ActivityEvent("2026-05-03T22:06:11Z", "cron_start",
                txt("EventBridge trigger · weekly cron")),
            ActivityEvent("2026-04-30T14:22:08Z", "config",
                txt("Active flag set TRUE · via SSM")),
            ActivityEvent("2026-04-26T22:08:42Z", "run_complete",
                txt("Weekly run complete · 2 recs · dry-run")),
            ActivityEvent("2026-04-26T22:07:51Z", "congressional",
                txt("14 new congressional disclosures filed")),
            ActivityEvent("2026-04-19T22:07:55Z", "no_actions",
                txt("No actions taken · earnings density")),
            ActivityEvent("2026-04-12T22:11:03Z", "run_complete",
                txt("Weekly run complete · 4 recs · dry-run")),
        )
    }
}
