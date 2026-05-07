@file:OptIn(
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package com.claudeportfolio.app.ui.screens

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudeportfolio.app.data.model.Recommendation
import com.claudeportfolio.app.data.model.RunSummary
import com.claudeportfolio.app.ui.LocalApi
import com.claudeportfolio.app.ui.LocalEyebrows
import com.claudeportfolio.app.ui.LocalRefreshTick
import com.claudeportfolio.app.ui.UiState
import com.claudeportfolio.app.ui.format.fmtDateEyebrow
import com.claudeportfolio.app.ui.format.fmtNum
import com.claudeportfolio.app.ui.format.fmtUsd
import com.claudeportfolio.app.ui.rememberLoadable
import com.claudeportfolio.app.ui.theme.LocalPortfolioTypography
import com.claudeportfolio.app.ui.theme.PortfolioColors

/**
 * Last run screen. Sections per the handoff:
 *   - Summary block (eyebrow + summary paragraph + flex-wrap stats row)
 *   - Recommendations list with tap-to-expand rows
 *
 * Used by both the bottom-nav "Last run" tab and the History → run detail
 * push. The shared body composable [RunBody] is parameterized by the
 * RunSummary so each entry point just supplies different data.
 */
@Composable
fun LastRunScreen() {
    val api = LocalApi.current
    val tick = LocalRefreshTick.current
    val eyebrows = LocalEyebrows.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var isRefreshing by remember { mutableStateOf(false) }
    val state = rememberLoadable(tick, refreshKey) { api.getRunsLatest() }
    LaunchedEffect(state) {
        if (state !is UiState.Loading) isRefreshing = false
        if (state is UiState.Ready) {
            val run = state.data
            eyebrows["LastRun"] = if (run == null) "—"
                else "${fmtDateEyebrow(run.runDate)} · ${if (run.dryRun) "DRY-RUN" else "LIVE"}"
        }
    }
    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            isRefreshing = true
            refreshKey++
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        when (state) {
            is UiState.Loading -> com.claudeportfolio.app.ui.components.LastRunSkeleton()
            is UiState.Error   -> ErrorBanner(state.message)
            is UiState.Ready   -> {
                val run = state.data
                if (run == null) EmptyMessage("No runs yet.") else RunBody(run)
            }
        }
    }
}

@Composable
fun RunBody(run: RunSummary) {
    val type = LocalPortfolioTypography.current

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(PortfolioColors.Bg)
            .padding(start = 22.dp, end = 22.dp, top = 8.dp, bottom = 24.dp),
    ) {
        // ── Summary block ─────────────────────────────────────────────
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp, bottom = 18.dp)
                    .drawBottomLine(),
            ) {
                Text("SUMMARY", style = type.eyebrow, color = PortfolioColors.Dim)
                if (!run.summary.isNullOrBlank()) {
                    Text(
                        text = run.summary,
                        style = type.body.copy(lineHeight = 21.sp),
                        color = PortfolioColors.Fg,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
                FlowRow(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 18.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Stat("RECS", fmtNum(run.recommendations.size.toDouble()))
                    Stat("DRY-RUN", fmtNum(run.executor.dryRun.toDouble()))
                    Stat("QUEUED", fmtNum(run.executor.queuedForReview.toDouble()))
                    Stat("FAILED", fmtNum(run.executor.failed.toDouble()))
                    Stat("SEARCHES", fmtNum((run.analystMeta.webSearchesUsed ?: 0).toDouble()))
                    Stat("COST", fmtCost(run.analystMeta.inputTokens, run.analystMeta.outputTokens))
                }
            }
        }

        // ── Recommendations section header ──────────────────────────
        item {
            Text(
                text = "${run.recommendations.size} RECOMMENDATIONS",
                style = type.eyebrow,
                color = PortfolioColors.Dim,
                modifier = Modifier.padding(top = 18.dp, bottom = 4.dp),
            )
        }

        // ── Recommendation rows ─────────────────────────────────────
        items(run.recommendations) { rec -> RecommendationRow(rec) }
    }
}

@Composable
private fun RecommendationRow(rec: Recommendation) {
    val type = LocalPortfolioTypography.current
    var expanded by remember(rec) { mutableStateOf(false) }

    val actionColor = if (rec.action.equals("buy", ignoreCase = true))
        PortfolioColors.Pos else PortfolioColors.Neg

    val (statusLabel, statusColor) = statusLabelAndColor(rec.status)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { expanded = !expanded }
            .padding(vertical = 14.dp)
            .drawBottomLine()
            .animateContentSize(),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Col 1 — action (BUY/SELL)
            Text(
                text = rec.action.uppercase(),
                style = type.microLabel.copy(fontWeight = FontWeight.SemiBold),
                color = actionColor,
                modifier = Modifier
                    .padding(end = 12.dp)
                    .widthIn(min = 28.dp),
            )
            // Col 2 — ticker + amount, then rationale first sentence
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(rec.ticker,
                         style = type.sectionTicker, color = PortfolioColors.Fg)
                    Text("  ${formatAmount(rec)}",
                         style = type.caption, color = PortfolioColors.Dim,
                         modifier = Modifier.padding(start = 6.dp))
                }
                Text(
                    text = rec.rationale.firstSentence(),
                    style = type.caption,
                    color = PortfolioColors.Dim,
                    maxLines = if (expanded) Int.MAX_VALUE else 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            // Col 3 — status chip
            Text(
                text = statusLabel,
                style = type.microLabel,
                color = statusColor,
                modifier = Modifier.padding(start = 8.dp),
            )
        }

        // Expanded body — full rationale + mono meta line
        if (expanded) {
            Column(modifier = Modifier.padding(start = 40.dp, top = 12.dp)) {
                Text(
                    text = rec.rationale,
                    style = type.bodySecondary.copy(lineHeight = 21.sp),
                    color = PortfolioColors.Fg,
                )
                Text(
                    text = monoMetaFor(rec),
                    style = type.mono,
                    color = PortfolioColors.Dim,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    val type = LocalPortfolioTypography.current
    Column {
        Text(label, style = type.eyebrow, color = PortfolioColors.Dim)
        Text(
            value,
            style = type.body.copy(fontWeight = FontWeight.Medium),
            color = PortfolioColors.Fg,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

@Composable
private fun EmptyMessage(text: String) {
    Box(
        modifier = Modifier.fillMaxSize().background(PortfolioColors.Bg),
        contentAlignment = Alignment.Center,
    ) {
        Text(text,
             style = LocalPortfolioTypography.current.body,
             color = PortfolioColors.Dim)
    }
}

private fun statusLabelAndColor(status: String): Pair<String, Color> = when (status) {
    "executed"          -> "EXECUTED" to PortfolioColors.Pos
    "queued_for_review" -> "QUEUED"   to PortfolioColors.Amber
    "skipped"           -> "SKIPPED"  to PortfolioColors.Dim
    "failed"            -> "FAILED"   to PortfolioColors.Neg
    "dry_run"           -> "DRY-RUN"  to PortfolioColors.Dim
    "already_submitted" -> "ALREADY"  to PortfolioColors.Dim
    else                 -> status.uppercase() to PortfolioColors.Dim
}

private fun formatAmount(rec: Recommendation): String = when (rec.amount.type) {
    "dollars" -> fmtUsd(rec.amount.value, decimals = 0)
    "shares"  -> "${fmtNum(rec.amount.value)} sh"
    "percent" -> "${rec.amount.value.toInt()}%"
    else      -> rec.amount.value.toString()
}

private fun monoMetaFor(rec: Recommendation): String {
    val sizing = rec.sizing
    val sizingPart = when {
        sizing == null -> "sizing → —"
        sizing.kind == "qty"      -> "sizing → qty ${fmtNum(sizing.value, decimals = 4)}"
        sizing.kind == "notional" -> "sizing → notional ${"%.2f".format(sizing.value ?: 0.0)}"
        sizing.kind == "error"    -> "sizing → error ${sizing.message ?: "?"}"
        else -> "sizing → ${sizing.kind}"
    }
    val thesis = rec.linkedThesis ?: "—"
    return "$sizingPart · linkedThesis $thesis · confidence ${rec.confidence}"
}

private fun fmtCost(input: Int?, output: Int?): String {
    // Rough Opus 4.7 list pricing: $5/M input, $25/M output.
    val cost = ((input ?: 0) * 5.0 + (output ?: 0) * 25.0) / 1_000_000.0
    return "$" + "%.2f".format(cost)
}

private fun String.firstSentence(): String {
    val end = indexOfAny(charArrayOf('.', '!', '?'))
    return if (end == -1) this else substring(0, end + 1)
}

