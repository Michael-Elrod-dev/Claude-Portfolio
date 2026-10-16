@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.claudeportfolio.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import com.claudeportfolio.app.data.model.RunListItem
import com.claudeportfolio.app.ui.LocalApi
import com.claudeportfolio.app.ui.LocalEyebrows
import com.claudeportfolio.app.ui.LocalRefreshTick
import com.claudeportfolio.app.ui.UiState
import com.claudeportfolio.app.ui.components.CardAccent
import com.claudeportfolio.app.ui.components.KilnCard
import com.claudeportfolio.app.ui.components.KilnChip
import com.claudeportfolio.app.ui.components.HistorySkeleton
import com.claudeportfolio.app.ui.components.SectionLabel
import com.claudeportfolio.app.ui.components.Tone
import com.claudeportfolio.app.ui.format.fmtDateLong
import com.claudeportfolio.app.ui.rememberLoadable
import com.claudeportfolio.app.ui.theme.KilnColors
import com.claudeportfolio.app.ui.theme.KilnSpace
import com.claudeportfolio.app.ui.theme.LocalKilnTypography
import com.claudeportfolio.app.ui.theme.metaMonoSmall
import com.claudeportfolio.app.ui.theme.smallBody

/**
 * History, in Kiln. One card per archived run; tapping pushes RunDetail.
 *
 * The right-hand column shows the executor tally. A run with failures gets
 * a danger-bordered card so a bad week is visible without opening it.
 *
 * Only ~9 runs are ever present (the store prunes runs after 30 days), so
 * this list is short by construction.
 */
@Composable
fun HistoryScreen(onRunClick: (runDate: String) -> Unit) {
    val api = LocalApi.current
    val tick = LocalRefreshTick.current
    val eyebrows = LocalEyebrows.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var isRefreshing by remember { mutableStateOf(false) }
    val state = rememberLoadable(api, tick, refreshKey) { api.getRunsList(limit = 20) }

    LaunchedEffect(state) {
        if (state !is UiState.Loading) isRefreshing = false
        if (state is UiState.Ready) {
            val n = state.data.size
            eyebrows["History"] =
                if (n == 0) "NO RUNS YET" else "$n RUN${if (n == 1) "" else "S"} · 30-DAY TTL"
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
            is UiState.Loading -> HistorySkeleton()
            is UiState.Error -> ErrorBanner(state.message)
            is UiState.Ready -> HistoryBody(state.data, onRunClick)
        }
    }
}

@Composable
private fun HistoryBody(runs: List<RunListItem>, onClick: (String) -> Unit) {
    if (runs.isEmpty()) {
        ScreenEmpty(
            headline = "No runs archived",
            copy = "Records appear after a scheduled run and expire 30 days later.",
        )
        return
    }

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
        items(runs, key = { it.runDate }) { run ->
            HistoryCard(run, onClick)
            Spacer(Modifier.height(KilnSpace.gapGrid))
        }
    }
}

@Composable
private fun HistoryCard(run: RunListItem, onClick: (String) -> Unit) {
    val type = LocalKilnTypography.current
    val interaction = remember { MutableInteractionSource() }
    val hadFailures = run.executor.failed > 0
    val hadSourceErrors = run.briefingErrors.isNotEmpty()

    KilnCard(accent = if (hadFailures) CardAccent.Danger else CardAccent.None) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(interactionSource = interaction, indication = null) {
                    onClick(run.runDate)
                }
                .padding(KilnSpace.padCard),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = fmtDateLong(run.runDate),
                    style = type.rowTitle,
                    color = KilnColors.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                if (run.forced) {
                    KilnChip("FORCED", tone = Tone.Accent)
                    Spacer(Modifier.width(KilnSpace.gapChip))
                }
                Text(
                    text = "${run.durationSec}s",
                    style = type.metaMonoSmall,
                    color = KilnColors.textFaint,
                )
            }

            if (!run.summary.isNullOrBlank()) {
                Spacer(Modifier.height(KilnSpace.s5))
                Text(
                    text = run.summary,
                    style = type.smallBody,
                    color = KilnColors.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Spacer(Modifier.height(KilnSpace.s8))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KilnSpace.gapChip),
            ) {
                if (run.recCount == 0) {
                    KilnChip("NO ACTIONS", tone = Tone.Neutral)
                } else {
                    KilnChip("${run.executor.executed} EXECUTED", tone = Tone.Success)
                    if (hadFailures) {
                        KilnChip("${run.executor.failed} FAILED", tone = Tone.Danger)
                    }
                    if (run.executor.skipped > 0) {
                        KilnChip("${run.executor.skipped} SKIPPED", tone = Tone.Neutral)
                    }
                }
                if (hadSourceErrors) {
                    KilnChip("${run.briefingErrors.size} SOURCE ERR", tone = Tone.Warning)
                }
            }
        }
    }
}
