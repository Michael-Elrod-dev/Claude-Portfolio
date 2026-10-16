@file:OptIn(
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package com.claudeportfolio.app.ui.screens

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.text.style.TextOverflow
import com.claudeportfolio.app.data.model.Recommendation
import com.claudeportfolio.app.data.model.RunSummary
import com.claudeportfolio.app.ui.LocalApi
import com.claudeportfolio.app.ui.LocalEyebrows
import com.claudeportfolio.app.ui.LocalRefreshTick
import com.claudeportfolio.app.ui.UiState
import com.claudeportfolio.app.ui.components.KilnCard
import com.claudeportfolio.app.ui.components.KilnChip
import com.claudeportfolio.app.ui.components.KilnEmptyState
import com.claudeportfolio.app.ui.components.KilnPill
import com.claudeportfolio.app.ui.components.KilnStatTile
import com.claudeportfolio.app.ui.components.LastRunSkeleton
import com.claudeportfolio.app.ui.components.SectionLabel
import com.claudeportfolio.app.ui.components.Tone
import com.claudeportfolio.app.ui.format.fmtDateEyebrow
import com.claudeportfolio.app.ui.format.fmtNum
import com.claudeportfolio.app.ui.format.fmtShares
import com.claudeportfolio.app.ui.format.fmtUsd
import com.claudeportfolio.app.ui.rememberLoadable
import com.claudeportfolio.app.ui.theme.KilnColors
import com.claudeportfolio.app.ui.theme.KilnSpace
import com.claudeportfolio.app.ui.theme.LocalKilnTypography
import com.claudeportfolio.app.ui.theme.metaMonoSmall
import com.claudeportfolio.app.ui.theme.smallBody

/**
 * Last run, in Kiln.
 *
 * Shared by the "Last run" tab and the History → run-detail push, which is
 * why [RunBody] takes the summary rather than fetching it.
 *
 * One colour decision worth recording: BUY/SELL is rendered as a NEUTRAL
 * chip, not a green/red one. Direction is not an outcome — a sell is not a
 * failure — and Kiln's status hues mean "succeeded / check this / failed".
 * Letting green also mean "buy" would make one colour carry two unrelated
 * signals, so the coloured pill on each row is the execution status and the
 * direction stays monochrome.
 */
@Composable
fun LastRunScreen() {
    val api = LocalApi.current
    val tick = LocalRefreshTick.current
    val eyebrows = LocalEyebrows.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var isRefreshing by remember { mutableStateOf(false) }
    val state = rememberLoadable(api, tick, refreshKey) { api.getRunsLatest() }

    LaunchedEffect(state) {
        if (state !is UiState.Loading) isRefreshing = false
        if (state is UiState.Ready) {
            val run = state.data
            eyebrows["LastRun"] = if (run == null) "—" else fmtDateEyebrow(run.runDate)
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
            is UiState.Loading -> LastRunSkeleton()
            is UiState.Error -> ErrorBanner(state.message)
            is UiState.Ready -> {
                val run = state.data
                if (run == null) {
                    ScreenEmpty(
                        headline = "No runs yet",
                        copy = "The pipeline archives a record every Monday and Thursday.",
                    )
                } else {
                    RunBody(run)
                }
            }
        }
    }
}

@Composable
fun RunBody(run: RunSummary) {
    val type = LocalKilnTypography.current

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(KilnColors.surfaceApp),
        contentPadding = PaddingValues(
            start = KilnSpace.padScreenH,
            end = KilnSpace.padScreenH,
            top = KilnSpace.padScreenV,
            bottom = KilnSpace.s18,
        ),
    ) {
        // ── Analyst summary ──────────────────────────────────────────────
        if (!run.summary.isNullOrBlank()) {
            item {
                KilnCard(padded = true) {
                    SectionLabel("Analyst summary")
                    Spacer(Modifier.height(KilnSpace.s6))
                    // Prose a model wrote, so sans, not mono.
                    Text(
                        text = run.summary,
                        style = type.body,
                        color = KilnColors.textBody,
                    )
                }
                Spacer(Modifier.height(KilnSpace.gapSection))
            }
        }

        // ── Run stats ────────────────────────────────────────────────────
        item {
            Column {
                Row(
                    modifier = Modifier.height(IntrinsicSize.Min),
                    horizontalArrangement = Arrangement.spacedBy(KilnSpace.gapGrid),
                ) {
                    KilnStatTile("Recs", fmtNum(run.recommendations.size.toDouble()), Modifier.weight(1f))
                    KilnStatTile(
                        "Executed",
                        fmtNum(run.executor.executed.toDouble()),
                        Modifier.weight(1f),
                        valueColor = if (run.executor.executed > 0) {
                            KilnColors.successText
                        } else KilnColors.textPrimary,
                    )
                    KilnStatTile(
                        "Failed",
                        fmtNum(run.executor.failed.toDouble()),
                        Modifier.weight(1f),
                        valueColor = if (run.executor.failed > 0) {
                            KilnColors.dangerText
                        } else KilnColors.textPrimary,
                    )
                }
                Spacer(Modifier.height(KilnSpace.gapGrid))
                Row(
                    modifier = Modifier.height(IntrinsicSize.Min),
                    horizontalArrangement = Arrangement.spacedBy(KilnSpace.gapGrid),
                ) {
                    KilnStatTile(
                        "Searches",
                        fmtNum((run.analystMeta.webSearchesUsed ?: 0).toDouble()),
                        Modifier.weight(1f),
                        sub = "of 15",
                    )
                    KilnStatTile(
                        "Duration",
                        "${run.durationSec}s",
                        Modifier.weight(1f),
                        sub = "of 900s",
                    )
                    KilnStatTile(
                        "Cost",
                        fmtCost(run.analystMeta.inputTokens, run.analystMeta.outputTokens),
                        Modifier.weight(1f),
                        sub = run.analystMeta.model?.substringAfter("claude-"),
                    )
                }
            }
            Spacer(Modifier.height(KilnSpace.gapSection))
        }

        // ── Recommendations ──────────────────────────────────────────────
        item {
            SectionLabel(
                "${run.recommendations.size} " +
                    if (run.recommendations.size == 1) "recommendation" else "recommendations",
                modifier = Modifier.padding(bottom = KilnSpace.s7),
            )
        }

        if (run.recommendations.isEmpty()) {
            item {
                KilnCard {
                    KilnEmptyState(
                        headline = "No trades",
                        copy = "The analyst chose to hold everything this run.",
                    )
                }
            }
        } else {
            items(run.recommendations) { rec ->
                RecommendationCard(rec)
                Spacer(Modifier.height(KilnSpace.gapGrid))
            }
        }
    }
}

@Composable
private fun RecommendationCard(rec: Recommendation) {
    val type = LocalKilnTypography.current
    var expanded by remember(rec) { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    val (statusLabel, statusTone) = statusLabelAndTone(rec.status)

    KilnCard(
        accent = if (rec.status == "failed") com.claudeportfolio.app.ui.components.CardAccent.Danger
                 else com.claudeportfolio.app.ui.components.CardAccent.None,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(
                    interactionSource = interaction,
                    indication = null,
                ) { expanded = !expanded }
                .padding(KilnSpace.padCard)
                .animateContentSize(),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                KilnChip(rec.action, tone = Tone.Neutral)
                Spacer(Modifier.width(KilnSpace.s7))
                Text(
                    text = rec.ticker,
                    style = type.identity.copy(
                        fontFamily = type.metaMono.fontFamily,
                        letterSpacing = type.status.letterSpacing,
                    ),
                    color = KilnColors.textPrimary,
                )
                Spacer(Modifier.width(KilnSpace.s4))
                Text(
                    text = formatAmount(rec),
                    style = type.metaMonoSmall,
                    color = KilnColors.textSecondary,
                    modifier = Modifier.weight(1f),
                )
                KilnPill(statusLabel, tone = statusTone)
            }

            Spacer(Modifier.height(KilnSpace.s7))
            Text(
                text = if (expanded) rec.rationale else rec.rationale.firstSentence(),
                style = type.smallBody,
                color = KilnColors.textSecondary,
                maxLines = if (expanded) Int.MAX_VALUE else 2,
                overflow = TextOverflow.Ellipsis,
            )

            if (expanded) {
                Spacer(Modifier.height(KilnSpace.s8))
                com.claudeportfolio.app.ui.components.HairlineDivider()
                Spacer(Modifier.height(KilnSpace.s8))
                Text(
                    text = monoMetaFor(rec),
                    style = type.metaMonoSmall,
                    color = KilnColors.textFaint,
                )
                if (!rec.reason.isNullOrBlank()) {
                    Spacer(Modifier.height(KilnSpace.s4))
                    Text(
                        text = rec.reason,
                        style = type.metaMonoSmall,
                        color = if (rec.status == "failed") {
                            KilnColors.dangerText
                        } else KilnColors.textFaint,
                    )
                }
            }
        }
    }
}

@Composable
internal fun ScreenEmpty(headline: String, copy: String? = null) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(KilnColors.surfaceApp),
        contentAlignment = Alignment.Center,
    ) {
        KilnEmptyState(headline = headline, copy = copy)
    }
}

private fun statusLabelAndTone(status: String): Pair<String, Tone> = when (status) {
    "executed" -> "EXECUTED" to Tone.Success
    "skipped" -> "SKIPPED" to Tone.Neutral
    "failed" -> "FAILED" to Tone.Danger
    "already_submitted" -> "PRIOR RUN" to Tone.Neutral
    else -> status.uppercase() to Tone.Neutral
}

private fun formatAmount(rec: Recommendation): String = when (rec.amount.type) {
    "dollars" -> fmtUsd(rec.amount.value, decimals = 2)
    "shares" -> "${fmtShares(rec.amount.value)} sh"
    "percent" -> "${rec.amount.value.toInt()}%"
    else -> rec.amount.value.toString()
}

private fun monoMetaFor(rec: Recommendation): String {
    val sizing = rec.sizing
    val sizingPart = when {
        sizing == null -> "sizing → —"
        sizing.kind == "qty" -> "sizing → qty ${fmtNum(sizing.value, decimals = 6)}"
        sizing.kind == "close" -> "sizing → close position"
        sizing.kind == "notional" -> "sizing → notional ${"%.2f".format(sizing.value ?: 0.0)}"
        sizing.kind == "error" -> "sizing → error ${sizing.message ?: "?"}"
        else -> "sizing → ${sizing.kind}"
    }
    val thesis = rec.linkedThesis ?: "—"
    return "$sizingPart · thesis $thesis · confidence ${rec.confidence}"
}

/**
 * Per-run Analyst cost. Opus 5.5 list pricing: $4/M input, $20/M output.
 *
 * This covers the Analyst call only — the MemoUpdater's usage is not archived
 * in the run record, so the real per-run bill is roughly double this plus
 * about $0.12 of web search.
 */
private fun fmtCost(input: Int?, output: Int?): String {
    val cost = ((input ?: 0) * 4.0 + (output ?: 0) * 20.0) / 1_000_000.0
    return "$" + "%.2f".format(cost)
}

private fun String.firstSentence(): String {
    val end = indexOfAny(charArrayOf('.', '!', '?'))
    return if (end == -1) this else substring(0, end + 1)
}
