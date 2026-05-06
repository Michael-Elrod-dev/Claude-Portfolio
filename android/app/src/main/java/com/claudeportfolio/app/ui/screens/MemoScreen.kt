@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.claudeportfolio.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudeportfolio.app.data.model.ClosedThesis
import com.claudeportfolio.app.data.model.Memo
import com.claudeportfolio.app.data.model.OpenThesis
import com.claudeportfolio.app.ui.LocalApi
import com.claudeportfolio.app.ui.LocalRefreshTick
import com.claudeportfolio.app.ui.UiState
import com.claudeportfolio.app.ui.format.fmtDateEyebrow
import com.claudeportfolio.app.ui.rememberLoadable
import com.claudeportfolio.app.ui.theme.LocalPortfolioTypography
import com.claudeportfolio.app.ui.theme.PortfolioColors

/**
 * Memo screen.
 *
 * One-line description, then a horizontal section tab strip
 * (Open · Closed · Watchlist · Notes). Each section is rendered inline
 * below the strip; switching sections does *not* affect the bottom-nav tab.
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
    val state = rememberLoadable(tick) { api.getMemo() }
    when (state) {
        is UiState.Loading -> com.claudeportfolio.app.ui.components.MemoSkeleton()
        is UiState.Error   -> ErrorBanner(state.message)
        is UiState.Ready   -> MemoBody(state.data)
    }
}

@Composable
private fun MemoBody(memo: Memo) {
    val type = LocalPortfolioTypography.current
    var section by remember { mutableStateOf(MemoSection.Open) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(PortfolioColors.Bg),
    ) {
        Text(
            text = "Claude's working memory across runs. Rewritten at the end of every weekly run.",
            style = type.bodySecondary,
            color = PortfolioColors.Dim,
            modifier = Modifier.padding(start = 22.dp, end = 22.dp, top = 8.dp),
        )

        // Section tab strip
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 22.dp, end = 22.dp, top = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            for (s in MemoSection.entries) {
                val count = countFor(s, memo)
                SectionTab(
                    label = s.label,
                    count = count,
                    selected = s == section,
                    onClick = { section = s },
                )
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        when (section) {
            MemoSection.Open      -> OpenList(memo.openTheses)
            MemoSection.Closed    -> ClosedList(memo.closedTheses)
            MemoSection.Watchlist -> WatchlistChips(memo.watchlist)
            MemoSection.Notes     -> NotesBlock(memo.generalObservations)
        }
    }
}

private fun countFor(s: MemoSection, m: Memo): Int = when (s) {
    MemoSection.Open      -> m.openTheses.size
    MemoSection.Closed    -> m.closedTheses.size
    MemoSection.Watchlist -> m.watchlist.size
    MemoSection.Notes     -> if (m.generalObservations.isBlank()) 0 else 1
}

@Composable
private fun SectionTab(
    label: String,
    count: Int,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val type = LocalPortfolioTypography.current
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clickable(onClick = onClick)
            .drawBehind {
                if (selected) {
                    val y = size.height
                    drawLine(
                        color = PortfolioColors.Fg,
                        start = Offset(0f, y),
                        end = Offset(size.width, y),
                        strokeWidth = 2f,
                    )
                }
            }
            .padding(bottom = 6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = label,
                style = type.body.copy(
                    fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
                ),
                color = if (selected) PortfolioColors.Fg else PortfolioColors.Dim,
            )
            if (count > 0) {
                Text(
                    text = "  $count",
                    style = type.caption,
                    color = PortfolioColors.Dim2,
                )
            }
        }
    }
}

@Composable
private fun OpenList(theses: List<OpenThesis>) {
    val type = LocalPortfolioTypography.current
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 22.dp),
    ) {
        items(theses, key = { it.ticker }) { t ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 14.dp)
                    .drawBottomLine(),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(t.ticker, style = type.sectionTicker, color = PortfolioColors.Fg)
                    Text(
                        text = "OPENED ${fmtDateEyebrow(t.openedRun)}",
                        style = type.eyebrow,
                        color = PortfolioColors.Dim,
                    )
                }
                Text(
                    text = t.thesis,
                    style = type.bodySecondary.copy(lineHeight = 21.sp),
                    color = PortfolioColors.Fg,
                    modifier = Modifier.padding(top = 8.dp),
                )
                if (t.watchFor.isNotEmpty()) {
                    Text(
                        "WATCH FOR",
                        style = type.eyebrow,
                        color = PortfolioColors.Dim,
                        modifier = Modifier.padding(top = 10.dp, bottom = 4.dp),
                    )
                    for (w in t.watchFor) {
                        Text(
                            text = "·  $w",
                            style = type.caption.copy(lineHeight = 21.sp),
                            color = PortfolioColors.Dim,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ClosedList(theses: List<ClosedThesis>) {
    val type = LocalPortfolioTypography.current
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 22.dp),
    ) {
        items(theses, key = { it.ticker }) { t ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 14.dp)
                    .drawBottomLine(),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(t.ticker, style = type.sectionTicker, color = PortfolioColors.Dim)
                    Text(
                        text = "CLOSED ${fmtDateEyebrow(t.closedRun)}",
                        style = type.eyebrow,
                        color = PortfolioColors.Dim,
                    )
                }
                Text(
                    text = t.thesis,
                    style = type.bodySecondary.copy(
                        fontStyle = FontStyle.Italic,
                        lineHeight = 21.sp,
                    ),
                    color = PortfolioColors.Dim,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Text(
                    text = t.outcome,
                    style = type.bodySecondary.copy(lineHeight = 21.sp),
                    color = PortfolioColors.Fg,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun WatchlistChips(watchlist: List<String>) {
    val type = LocalPortfolioTypography.current
    FlowRow(
        modifier = Modifier
            .fillMaxSize()
            .padding(start = 22.dp, end = 22.dp, top = 18.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (sym in watchlist) {
            Text(
                text = sym,
                style = type.bodySecondary.copy(fontWeight = FontWeight.Medium),
                color = PortfolioColors.Fg,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .border(
                        width = 1.dp,
                        color = PortfolioColors.Line2,
                        shape = RoundedCornerShape(999.dp),
                    )
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }
    }
}

@Composable
private fun NotesBlock(text: String) {
    val type = LocalPortfolioTypography.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(start = 22.dp, end = 22.dp, top = 18.dp),
    ) {
        Text(
            text = text.ifBlank { "No notes." },
            style = type.body.copy(lineHeight = 22.sp),
            color = PortfolioColors.Fg,
        )
    }
}
