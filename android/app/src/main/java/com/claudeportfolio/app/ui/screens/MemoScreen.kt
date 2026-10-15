@file:OptIn(
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package com.claudeportfolio.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.claudeportfolio.app.data.model.ClosedThesis
import com.claudeportfolio.app.data.model.Memo
import com.claudeportfolio.app.data.model.OpenThesis
import com.claudeportfolio.app.ui.LocalApi
import com.claudeportfolio.app.ui.LocalEyebrows
import com.claudeportfolio.app.ui.LocalRefreshTick
import com.claudeportfolio.app.ui.UiState
import com.claudeportfolio.app.ui.components.HairlineDivider
import com.claudeportfolio.app.ui.components.KilnCard
import com.claudeportfolio.app.ui.components.KilnEmptyState
import com.claudeportfolio.app.ui.components.MemoSkeleton
import com.claudeportfolio.app.ui.components.SectionLabel
import com.claudeportfolio.app.ui.format.fmtDateEyebrow
import com.claudeportfolio.app.ui.rememberLoadable
import com.claudeportfolio.app.ui.theme.KilnColors
import com.claudeportfolio.app.ui.theme.KilnRadius
import com.claudeportfolio.app.ui.theme.KilnSpace
import com.claudeportfolio.app.ui.theme.LocalKilnTypography
import com.claudeportfolio.app.ui.theme.metaMonoSmall
import com.claudeportfolio.app.ui.theme.smallBody

/**
 * Memo, in Kiln — Claude's own working memory, rewritten after every run.
 *
 * A tab strip switches between Open theses, Closed theses, the Watchlist and
 * free-form Notes. The selected tab is marked with a clay underline: clay is
 * Kiln's "the live thing" colour, and the section you are reading qualifies.
 *
 * Watchlist tickers are rendered as 8dp-radius tags rather than pills. Kiln
 * reserves full pills for things that report a STATE; a watchlist entry is
 * content.
 */
private enum class MemoSection(val label: String) {
    Open("Open"),
    Closed("Closed"),
    Watchlist("Watchlist"),
    Notes("Notes"),
}

@Composable
fun MemoScreen() {
    val api = LocalApi.current
    val tick = LocalRefreshTick.current
    val eyebrows = LocalEyebrows.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var isRefreshing by remember { mutableStateOf(false) }
    val state = rememberLoadable(api, tick, refreshKey) { api.getMemo() }

    LaunchedEffect(state) {
        if (state !is UiState.Loading) isRefreshing = false
        if (state is UiState.Ready) {
            val updated = state.data.lastUpdated
            eyebrows["Memo"] =
                if (updated.isNullOrBlank()) "WORKING MEMORY" else "UPDATED ${fmtDateEyebrow(updated)}"
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
            is UiState.Loading -> MemoSkeleton()
            is UiState.Error -> ErrorBanner(state.message)
            is UiState.Ready -> MemoBody(state.data)
        }
    }
}

@Composable
private fun MemoBody(memo: Memo) {
    val type = LocalKilnTypography.current
    var section by remember { mutableStateOf(MemoSection.Open) }

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
        item {
            Text(
                text = "Claude's working memory. Rewritten at the end of every run; " +
                    "positions and cash always come from Alpaca, never from here.",
                style = type.smallBody,
                color = KilnColors.textSecondary,
            )
            Spacer(Modifier.height(KilnSpace.s11))
            SectionTabs(selected = section, memo = memo, onSelect = { section = it })
            Spacer(Modifier.height(KilnSpace.s11))
        }

        when (section) {
            MemoSection.Open -> {
                if (memo.openTheses.isEmpty()) {
                    item { EmptyCard("No open theses", "Nothing is held on a recorded thesis.") }
                } else {
                    items(memo.openTheses, key = { "open-" + it.ticker }) { t ->
                        OpenThesisCard(t)
                        Spacer(Modifier.height(KilnSpace.gapGrid))
                    }
                }
            }
            MemoSection.Closed -> {
                if (memo.closedTheses.isEmpty()) {
                    item { EmptyCard("No closed theses", "Exited positions and their outcomes land here.") }
                } else {
                    items(memo.closedTheses, key = { "closed-" + it.ticker + it.closedRun }) { t ->
                        ClosedThesisCard(t)
                        Spacer(Modifier.height(KilnSpace.gapGrid))
                    }
                }
            }
            MemoSection.Watchlist -> item { Watchlist(memo.watchlist) }
            MemoSection.Notes -> item { Notes(memo.generalObservations) }
        }
    }
}

@Composable
private fun SectionTabs(
    selected: MemoSection,
    memo: Memo,
    onSelect: (MemoSection) -> Unit,
) {
    Column {
        Row(horizontalArrangement = Arrangement.spacedBy(KilnSpace.s13)) {
            for (s in MemoSection.entries) {
                SectionTab(
                    label = s.label,
                    count = countFor(s, memo),
                    selected = s == selected,
                    onClick = { onSelect(s) },
                )
            }
        }
        HairlineDivider(color = KilnColors.hairlineStructural)
    }
}

private fun countFor(s: MemoSection, m: Memo): Int = when (s) {
    MemoSection.Open -> m.openTheses.size
    MemoSection.Closed -> m.closedTheses.size
    MemoSection.Watchlist -> m.watchlist.size
    MemoSection.Notes -> if (m.generalObservations.isBlank()) 0 else 1
}

@Composable
private fun SectionTab(
    label: String,
    count: Int,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val type = LocalKilnTypography.current
    val interaction = remember { MutableInteractionSource() }
    Column(
        modifier = Modifier
            // Intrinsic width so the underline below spans the label, not the row.
            .width(IntrinsicSize.Max)
            .heightIn(min = KilnSpace.hitMobile)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
        verticalArrangement = Arrangement.Bottom,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = label,
                style = if (selected) type.rowTitle else type.cell,
                color = if (selected) KilnColors.textPrimary else KilnColors.textTertiary,
            )
            if (count > 0) {
                Spacer(Modifier.width(KilnSpace.s4))
                Text(
                    text = count.toString(),
                    style = type.metaMonoSmall,
                    color = if (selected) KilnColors.textSecondary else KilnColors.textFaint,
                )
            }
        }
        Spacer(Modifier.height(KilnSpace.s6))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(if (selected) KilnColors.accent else Color.Transparent),
        )
    }
}

@Composable
private fun OpenThesisCard(t: OpenThesis) {
    val type = LocalKilnTypography.current
    KilnCard(padded = true) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = t.ticker,
                style = type.identity.copy(
                    fontFamily = type.metaMono.fontFamily,
                    letterSpacing = type.status.letterSpacing,
                ),
                color = KilnColors.textPrimary,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = "OPENED ${fmtDateEyebrow(t.openedRun)}",
                style = type.metaMonoSmall,
                color = KilnColors.textTertiary,
            )
        }
        Spacer(Modifier.height(KilnSpace.s6))
        Text(text = t.thesis, style = type.body, color = KilnColors.textBody)

        if (t.watchFor.isNotEmpty()) {
            Spacer(Modifier.height(KilnSpace.s10))
            HairlineDivider()
            Spacer(Modifier.height(KilnSpace.s10))
            SectionLabel("Watch for")
            Spacer(Modifier.height(KilnSpace.s4))
            for (w in t.watchFor) {
                Row(modifier = Modifier.padding(top = KilnSpace.s2)) {
                    Text(
                        text = "·",
                        style = type.smallBody,
                        color = KilnColors.textFaint,
                        modifier = Modifier.width(KilnSpace.s10),
                    )
                    Text(text = w, style = type.smallBody, color = KilnColors.textSecondary)
                }
            }
        }
    }
}

@Composable
private fun ClosedThesisCard(t: ClosedThesis) {
    val type = LocalKilnTypography.current
    KilnCard(padded = true) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = t.ticker,
                style = type.identity.copy(
                    fontFamily = type.metaMono.fontFamily,
                    letterSpacing = type.status.letterSpacing,
                ),
                color = KilnColors.textSecondary,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = "CLOSED ${fmtDateEyebrow(t.closedRun)}",
                style = type.metaMonoSmall,
                color = KilnColors.textTertiary,
            )
        }
        Spacer(Modifier.height(KilnSpace.s6))
        // The thesis that was held, dimmed; the outcome is what matters now.
        Text(text = t.thesis, style = type.smallBody, color = KilnColors.textTertiary)
        Spacer(Modifier.height(KilnSpace.s10))
        HairlineDivider()
        Spacer(Modifier.height(KilnSpace.s10))
        SectionLabel("Outcome")
        Spacer(Modifier.height(KilnSpace.s4))
        Text(text = t.outcome, style = type.body, color = KilnColors.textBody)
    }
}

@Composable
private fun Watchlist(watchlist: List<String>) {
    val type = LocalKilnTypography.current
    if (watchlist.isEmpty()) {
        EmptyCard("Watchlist is empty", "Tickers the analyst wants surfaced in the earnings calendar.")
        return
    }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(KilnSpace.gapChip),
        verticalArrangement = Arrangement.spacedBy(KilnSpace.gapChip),
    ) {
        for (sym in watchlist) {
            Text(
                text = sym,
                style = type.status,
                color = KilnColors.textBody,
                modifier = Modifier
                    .clip(KilnRadius.chip)
                    .background(KilnColors.surfaceCard)
                    .border(KilnSpace.hairline, KilnColors.hairline, KilnRadius.chip)
                    .padding(horizontal = KilnSpace.padChipH, vertical = KilnSpace.padChipV),
            )
        }
    }
}

@Composable
private fun Notes(text: String) {
    val type = LocalKilnTypography.current
    if (text.isBlank()) {
        EmptyCard("No notes", "General observations the analyst carries between runs.")
        return
    }
    KilnCard(padded = true) {
        SectionLabel("General observations")
        Spacer(Modifier.height(KilnSpace.s6))
        Text(text = text, style = type.body, color = KilnColors.textBody)
    }
}

@Composable
private fun EmptyCard(headline: String, copy: String) {
    KilnCard { KilnEmptyState(headline = headline, copy = copy) }
}
