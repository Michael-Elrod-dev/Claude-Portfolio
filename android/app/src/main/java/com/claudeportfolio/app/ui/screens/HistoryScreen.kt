@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.claudeportfolio.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudeportfolio.app.data.model.RunListItem
import com.claudeportfolio.app.ui.LocalApi
import com.claudeportfolio.app.ui.LocalRefreshTick
import com.claudeportfolio.app.ui.UiState
import com.claudeportfolio.app.ui.format.fmtDateLong
import com.claudeportfolio.app.ui.format.fmtPct
import com.claudeportfolio.app.ui.rememberLoadable
import com.claudeportfolio.app.ui.theme.LocalPortfolioTypography
import com.claudeportfolio.app.ui.theme.PortfolioColors

/**
 * History screen — list of weekly runs. Tapping a row pushes RunDetail.
 *
 * Each row is a 2-column grid: left has the date (with a "NO ACTIONS"
 * chip if recCount==0) and the summary; right has the rec count and the
 * day P/L percentage colored green/red.
 */
@Composable
fun HistoryScreen(onRunClick: (runDate: String) -> Unit) {
    val api = LocalApi.current
    val tick = LocalRefreshTick.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var isRefreshing by remember { mutableStateOf(false) }
    val state = rememberLoadable(tick, refreshKey) { api.getRunsList(limit = 20) }
    LaunchedEffect(state) {
        if (state !is UiState.Loading) isRefreshing = false
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
            is UiState.Loading -> com.claudeportfolio.app.ui.components.HistorySkeleton()
            is UiState.Error   -> ErrorBanner(state.message)
            is UiState.Ready   -> HistoryBody(state.data, onRunClick)
        }
    }
}

@Composable
private fun HistoryBody(runs: List<RunListItem>, onClick: (String) -> Unit) {
    val type = LocalPortfolioTypography.current
    if (runs.isEmpty()) {
        EmptyMessage("No runs yet.")
        return
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(PortfolioColors.Bg)
            .padding(horizontal = 22.dp),
    ) {
        item {
            Text(
                text = "Tap a row to see the full run.",
                style = type.bodySecondary,
                color = PortfolioColors.Dim,
                modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
            )
        }
        items(runs, key = { it.runDate }) { run -> HistoryRow(run, onClick) }
    }
}

@Composable
private fun HistoryRow(run: RunListItem, onClick: (String) -> Unit) {
    val type = LocalPortfolioTypography.current
    val plPos = (run.dayPlPct ?: 0.0) >= 0
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick(run.runDate) }
            .padding(vertical = 14.dp)
            .drawBottomLine(),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = fmtDateLong(run.runDate),
                    style = type.body.copy(fontWeight = FontWeight.Medium, lineHeight = 21.sp),
                    color = PortfolioColors.Fg,
                )
                if (run.recCount == 0) {
                    Text(
                        text = "NO ACTIONS",
                        style = type.microLabel,
                        color = PortfolioColors.Dim,
                        modifier = Modifier
                            .padding(start = 8.dp)
                            .clip(RoundedCornerShape(999.dp))
                            .border(
                                width = 1.dp,
                                color = PortfolioColors.Line2,
                                shape = RoundedCornerShape(999.dp),
                            )
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
            }
            if (!run.summary.isNullOrBlank()) {
                Text(
                    text = run.summary,
                    style = type.caption.copy(lineHeight = 18.sp),
                    color = PortfolioColors.Dim,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier.padding(start = 12.dp),
        ) {
            Text(
                text = "${run.recCount} recs",
                style = type.caption,
                color = PortfolioColors.Dim,
            )
            Text(
                text = fmtPct(run.dayPlPct),
                style = type.caption,
                color = if (plPos) PortfolioColors.Pos else PortfolioColors.Neg,
            )
        }
    }
}

@Composable
private fun EmptyMessage(text: String) {
    androidx.compose.foundation.layout.Box(
        modifier = Modifier.fillMaxSize().background(PortfolioColors.Bg),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            style = LocalPortfolioTypography.current.body,
            color = PortfolioColors.Dim,
        )
    }
}
