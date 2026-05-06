@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.claudeportfolio.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudeportfolio.app.data.model.Portfolio
import com.claudeportfolio.app.data.model.Position
import com.claudeportfolio.app.ui.LocalApi
import com.claudeportfolio.app.ui.LocalRefreshTick
import com.claudeportfolio.app.ui.UiState
import com.claudeportfolio.app.ui.format.fmtPct
import com.claudeportfolio.app.ui.format.fmtUsd
import com.claudeportfolio.app.ui.rememberLoadable
import com.claudeportfolio.app.ui.theme.LocalPortfolioTypography
import com.claudeportfolio.app.ui.theme.PortfolioColors

/**
 * Vertical scroll layout per the handoff spec:
 *   - Equity hero block (40sp big number + day/week stats + cash line)
 *   - Section divider (1px Line)
 *   - "N POSITIONS · +X% ALL-TIME" eyebrow
 *   - List of position rows: ticker + qty + thesis on the left,
 *     market value + P/L% on the right
 */
@Composable
fun PortfolioScreen() {
    val api = LocalApi.current
    val tick = LocalRefreshTick.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var isRefreshing by remember { mutableStateOf(false) }
    val state = rememberLoadable(tick, refreshKey) { api.getPortfolio() }

    // Whenever the load resolves (Ready or Error), clear the refresh
    // indicator. We can't hook directly into rememberLoadable, but a
    // state-keyed effect is essentially the same thing.
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
            is UiState.Loading -> com.claudeportfolio.app.ui.components.PortfolioSkeleton()
            is UiState.Error   -> ErrorBanner(state.message)
            is UiState.Ready   -> PortfolioBody(state.data)
        }
    }
}

@Composable
private fun PortfolioBody(p: Portfolio) {
    val type = LocalPortfolioTypography.current
    val a = p.account
    val holdings = p.positions.holdings

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(PortfolioColors.Bg)
            .padding(start = 22.dp, end = 22.dp, top = 8.dp, bottom = 24.dp),
    ) {
        // ── Equity hero ──────────────────────────────────────────────
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp, bottom = 24.dp)
                    .drawBottomLine(),
            ) {
                Text("EQUITY", style = type.eyebrow, color = PortfolioColors.Dim)
                Text(
                    text = fmtUsd(a.equity, decimals = 2),
                    style = type.equityHero,
                    color = PortfolioColors.Fg,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(18.dp),
                    modifier = Modifier.padding(top = 14.dp),
                ) {
                    Stat(label = "TODAY",
                         value = "${fmtUsd(a.dayPl, sign = true)}  ${fmtPct(a.dayPlPct)}",
                         positive = a.dayPl >= 0)
                    Stat(label = "WEEK",
                         value = "${fmtUsd(a.weekPl, sign = true)}  ${fmtPct(a.weekPlPct)}",
                         positive = (a.weekPl ?: 0.0) >= 0)
                }
                Row(
                    modifier = Modifier.padding(top = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text("Cash", style = type.caption, color = PortfolioColors.Dim)
                    Text(fmtUsd(a.cash, decimals = 0),
                         style = type.caption, color = PortfolioColors.Fg)
                    Text("Buying power", style = type.caption, color = PortfolioColors.Dim)
                    Text(fmtUsd(a.buyingPower, decimals = 0),
                         style = type.caption, color = PortfolioColors.Fg)
                }
            }
        }

        // ── Positions section header ─────────────────────────────────
        item {
            val allTimePct = if (p.positions.totalCostBasis > 0) {
                p.positions.totalUnrealizedPl / p.positions.totalCostBasis
            } else 0.0
            Text(
                text = "${holdings.size} POSITIONS · ${fmtPct(allTimePct)} ALL-TIME",
                style = type.eyebrow,
                color = PortfolioColors.Dim,
                modifier = Modifier.padding(top = 18.dp, bottom = 4.dp),
            )
        }

        // ── Position rows ────────────────────────────────────────────
        items(holdings, key = { it.symbol }) { pos -> PositionRow(pos) }
    }
}

@Composable
private fun PositionRow(p: Position) {
    val type = LocalPortfolioTypography.current
    val plPos = p.unrealizedPl >= 0
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp)
            .drawBottomLine(),
    ) {
        // Left column — ticker + qty + thesis
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(p.symbol,
                     style = type.sectionTicker, color = PortfolioColors.Fg)
                Text(" ${p.qty.toInt()} sh",
                     style = type.eyebrow, color = PortfolioColors.Dim2,
                     modifier = Modifier.padding(start = 6.dp))
            }
            if (!p.thesis.isNullOrBlank()) {
                Text(
                    text = p.thesis,
                    style = type.caption,
                    color = PortfolioColors.Dim,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
        // Right column — value + P/L%
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = fmtUsd(p.marketValue, decimals = 0),
                style = type.sectionTicker.copy(fontWeight = FontWeight.Medium),
                color = PortfolioColors.Fg,
            )
            Text(
                text = fmtPct(p.unrealizedPlPct),
                style = type.caption,
                color = if (plPos) PortfolioColors.Pos else PortfolioColors.Neg,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

@Composable
private fun Stat(label: String, value: String, positive: Boolean) {
    val type = LocalPortfolioTypography.current
    Column {
        Text(label, style = type.eyebrow, color = PortfolioColors.Dim)
        Text(
            text = value,
            style = type.bodySecondary.copy(textAlign = TextAlign.Start),
            color = if (positive) PortfolioColors.Pos else PortfolioColors.Neg,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

/** Used to mark Loading globally; shown briefly with mock data. */
@Composable
internal fun LoadingPlaceholder() {
    Box(
        modifier = Modifier.fillMaxSize().background(PortfolioColors.Bg),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "Loading…",
            style = LocalPortfolioTypography.current.caption,
            color = PortfolioColors.Dim,
        )
    }
}

@Composable
internal fun ErrorBanner(message: String) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PortfolioColors.Bg)
            .padding(22.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "Couldn't load. $message",
            style = LocalPortfolioTypography.current.bodySecondary,
            color = PortfolioColors.Neg,
        )
    }
}

/**
 * Adds a 1px [PortfolioColors.Line] to the bottom of the receiver. Cheaper
 * than wrapping every section in a Surface with a border modifier and
 * matches the handoff's "section gaps via top/bottom borders, not large
 * margins" rule.
 */
internal fun Modifier.drawBottomLine(color: Color = PortfolioColors.Line): Modifier =
    this.drawBehind {
        val y = size.height
        drawLine(
            color = color,
            start = Offset(0f, y),
            end = Offset(size.width, y),
            strokeWidth = 1f,
        )
    }
