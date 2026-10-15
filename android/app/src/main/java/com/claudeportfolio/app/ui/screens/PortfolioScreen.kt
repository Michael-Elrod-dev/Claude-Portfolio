@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.claudeportfolio.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import com.claudeportfolio.app.data.model.Portfolio
import com.claudeportfolio.app.data.model.Position
import com.claudeportfolio.app.ui.LocalApi
import com.claudeportfolio.app.ui.LocalEyebrows
import com.claudeportfolio.app.ui.LocalRefreshTick
import com.claudeportfolio.app.ui.UiState
import com.claudeportfolio.app.ui.components.CardAccent
import com.claudeportfolio.app.ui.components.HairlineDivider
import com.claudeportfolio.app.ui.components.KilnCard
import com.claudeportfolio.app.ui.components.KilnStatTile
import com.claudeportfolio.app.ui.components.KilnStatusRow
import com.claudeportfolio.app.ui.components.PortfolioSkeleton
import com.claudeportfolio.app.ui.components.SectionLabel
import com.claudeportfolio.app.ui.format.fmtDayDateEyebrow
import com.claudeportfolio.app.ui.format.fmtPct
import com.claudeportfolio.app.ui.format.fmtShares
import com.claudeportfolio.app.ui.format.fmtUsd
import com.claudeportfolio.app.ui.rememberLoadable
import com.claudeportfolio.app.ui.theme.KilnColors
import com.claudeportfolio.app.ui.theme.KilnSpace
import com.claudeportfolio.app.ui.theme.LocalKilnTypography
import com.claudeportfolio.app.ui.theme.metaMonoSmall
import com.claudeportfolio.app.ui.theme.plColor
import com.claudeportfolio.app.ui.theme.smallBody

/**
 * Portfolio, in Kiln.
 *
 * Layout, top to bottom:
 *   - Equity hero: the one [KilnTypography.figure] on the screen, in mono,
 *     with the lifetime return beside it. Lifetime sits in the hero rather
 *     than in the tile grid because it is the headline number for this
 *     account — a single $100 deposit and nothing since, so total return is
 *     the honest measure of the whole experiment.
 *   - A 2x2 grid of window tiles: today, week, month, year. Five windows in
 *     one row does not fit a phone; the hero takes the fifth.
 *   - A cash card, as label/value rows rather than a cramped three-column
 *     grid.
 *   - Positions, in a single card with hairline row dividers.
 */
@Composable
fun PortfolioScreen() {
    val api = LocalApi.current
    val tick = LocalRefreshTick.current
    val eyebrows = LocalEyebrows.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var isRefreshing by remember { mutableStateOf(false) }
    val state = rememberLoadable(api, tick, refreshKey) { api.getPortfolio() }

    LaunchedEffect(state) {
        if (state !is UiState.Loading) isRefreshing = false
        if (state is UiState.Ready) {
            eyebrows["Portfolio"] = fmtDayDateEyebrow(state.data.asOf)
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
            is UiState.Loading -> PortfolioSkeleton()
            is UiState.Error -> ErrorBanner(state.message)
            is UiState.Ready -> PortfolioBody(state.data)
        }
    }
}

@Composable
private fun PortfolioBody(p: Portfolio) {
    val type = LocalKilnTypography.current
    val a = p.account
    val holdings = p.positions.holdings

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(KilnColors.surfaceApp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = KilnSpace.padScreenH,
            end = KilnSpace.padScreenH,
            top = KilnSpace.padScreenV,
            bottom = KilnSpace.s18,
        ),
    ) {
        // ── Equity hero ──────────────────────────────────────────────────
        item {
            Column(modifier = Modifier.fillMaxWidth()) {
                SectionLabel("Equity")
                Spacer(Modifier.height(KilnSpace.s4))
                Text(
                    text = fmtUsd(a.equity, decimals = 2),
                    style = type.figure,
                    color = KilnColors.textPrimary,
                )
                Spacer(Modifier.height(KilnSpace.s6))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = fmtPct(a.totalPlPct),
                        style = type.status,
                        color = plColor(a.totalPlPct),
                    )
                    Text(
                        text = "  ${fmtUsd(a.totalPl, sign = true, decimals = 2)}",
                        style = type.metaMono,
                        color = KilnColors.textSecondary,
                    )
                    Text(
                        text = "  all time",
                        style = type.metaMono,
                        color = KilnColors.textFaint,
                    )
                }
            }
            Spacer(Modifier.height(KilnSpace.gapSection))
        }

        // ── Window tiles ─────────────────────────────────────────────────
        item {
            Column {
                Row(
                    modifier = Modifier.height(IntrinsicSize.Min),
                    horizontalArrangement = Arrangement.spacedBy(KilnSpace.gapGrid),
                ) {
                    WindowTile("Today", a.dayPlPct, a.dayPl, Modifier.weight(1f))
                    WindowTile("Week", a.weekPlPct, a.weekPl, Modifier.weight(1f))
                }
                Spacer(Modifier.height(KilnSpace.gapGrid))
                Row(
                    modifier = Modifier.height(IntrinsicSize.Min),
                    horizontalArrangement = Arrangement.spacedBy(KilnSpace.gapGrid),
                ) {
                    WindowTile("Month", a.monthPlPct, a.monthPl, Modifier.weight(1f))
                    WindowTile("Year", a.yearPlPct, a.yearPl, Modifier.weight(1f))
                }
            }
            Spacer(Modifier.height(KilnSpace.gapSection))
        }

        // ── Cash ─────────────────────────────────────────────────────────
        item {
            KilnCard {
                KilnStatusRow("Cash", fmtUsd(a.cash, decimals = 2))
                KilnStatusRow("Buying power", fmtUsd(a.buyingPower, decimals = 2))
                KilnStatusRow("Cost basis", fmtUsd(a.costBasis, decimals = 2), divider = false)
            }
            Spacer(Modifier.height(KilnSpace.gapSection))
        }

        // ── Positions header ─────────────────────────────────────────────
        item {
            val allTimePct = if (p.positions.totalCostBasis > 0) {
                p.positions.totalUnrealizedPl / p.positions.totalCostBasis
            } else null
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = KilnSpace.s7),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SectionLabel(
                    "${holdings.size} ${if (holdings.size == 1) "position" else "positions"}",
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = fmtPct(allTimePct),
                    style = type.status,
                    color = plColor(allTimePct),
                )
                Text(
                    text = " unrealized",
                    style = type.metaMonoSmall,
                    color = KilnColors.textFaint,
                )
            }
        }

        // ── Positions ────────────────────────────────────────────────────
        if (holdings.isEmpty()) {
            item {
                KilnCard {
                    com.claudeportfolio.app.ui.components.KilnEmptyState(
                        headline = "No positions",
                        copy = "The account is all cash. The next run will decide what to buy.",
                    )
                }
            }
        } else {
            // One card, rows inside it. This book holds ten positions, so
            // lazy per-row items would buy nothing and would cost the card
            // its rounded corners and border.
            item {
                KilnCard {
                    holdings.forEachIndexed { index, pos ->
                        PositionRow(pos, isLast = index == holdings.lastIndex)
                    }
                }
            }
        }
    }
}

/**
 * One P/L window. Shows an em dash when the backend suppressed the window —
 * which is honest rather than broken: "year" is year-to-date, and on an
 * account funded in April 2026 that window still reaches back before
 * funding, so it would just restate the lifetime figure already in the hero.
 * It starts carrying a distinct number on 2027-01-01.
 */
@Composable
private fun WindowTile(
    label: String,
    pct: Double?,
    dollars: Double?,
    modifier: Modifier = Modifier,
) {
    KilnStatTile(
        label = label,
        value = fmtPct(pct),
        valueColor = plColor(pct),
        // Always two lines, so an empty window is the same shape as a full
        // one rather than a shorter box.
        sub = if (dollars == null) "—" else fmtUsd(dollars, sign = true, decimals = 2),
        modifier = modifier,
    )
}

@Composable
private fun PositionRow(p: Position, isLast: Boolean) {
    val type = LocalKilnTypography.current
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.Top,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = KilnSpace.padCard, vertical = KilnSpace.s8),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // Ticker is machine-owned: mono, not sans.
                    Text(
                        text = p.symbol,
                        style = type.identity.copy(
                            fontFamily = type.metaMono.fontFamily,
                            letterSpacing = type.status.letterSpacing,
                        ),
                        color = KilnColors.textPrimary,
                    )
                    Spacer(Modifier.width(KilnSpace.s4))
                    Text(
                        text = "${fmtShares(p.qty)} sh",
                        style = type.metaMonoSmall,
                        color = KilnColors.textFaint,
                    )
                }
                if (!p.thesis.isNullOrBlank()) {
                    Text(
                        text = p.thesis,
                        style = type.smallBody,
                        color = KilnColors.textSecondary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = KilnSpace.s2),
                    )
                }
            }
            Spacer(Modifier.width(KilnSpace.s8))
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = fmtUsd(p.marketValue, decimals = 2),
                    style = type.metaMono.copy(fontSize = type.cardTitle.fontSize),
                    color = KilnColors.textPrimary,
                )
                Spacer(Modifier.height(KilnSpace.s2))
                Text(
                    text = fmtPct(p.unrealizedPlPct),
                    style = type.outcome,
                    color = plColor(p.unrealizedPl),
                )
            }
        }
        if (!isLast) HairlineDivider(color = KilnColors.hairlineRow)
    }
}

@Composable
internal fun ErrorBanner(message: String) {
    val type = LocalKilnTypography.current
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(KilnColors.surfaceApp)
            .padding(KilnSpace.padScreenH),
        contentAlignment = Alignment.Center,
    ) {
        KilnCard(accent = CardAccent.Danger, padded = true) {
            Text(
                text = "Couldn't load",
                style = type.rowTitle,
                color = KilnColors.textPrimary,
            )
            Spacer(Modifier.height(KilnSpace.s2))
            Text(
                text = message,
                style = type.smallBody,
                color = KilnColors.dangerText,
            )
        }
    }
}
