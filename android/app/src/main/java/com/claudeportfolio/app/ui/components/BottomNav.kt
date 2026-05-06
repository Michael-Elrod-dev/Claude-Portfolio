package com.claudeportfolio.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudeportfolio.app.ui.theme.LocalPortfolioTypography
import com.claudeportfolio.app.ui.theme.PortfolioColors

/**
 * The five top-level tabs the bottom nav switches between.
 *
 * Order is fixed by the handoff: Portfolio · Last run · Memo · History · Settings.
 * `route` is the nav-graph route; `label` is what shows under the icon.
 */
enum class Tab(val route: String, val label: String) {
    Portfolio("portfolio", "Portfolio"),
    LastRun("last_run", "Last run"),
    Memo("memo", "Memo"),
    History("history", "History"),
    Settings("settings", "Settings"),
}

/**
 * Custom 5-tab bottom nav. Per handoff:
 *   - 5 columns, equal width
 *   - Icon (22×22) over a 10sp label
 *   - Active: full-Fg color, label weight 600. Inactive: Dim.
 *   - Top border: 1px Line. Background: Bg. Padding: 6 4 4.
 *   - No selected indicator pill (intentional — quieter design).
 */
@Composable
fun PortfolioBottomNav(
    active: Tab,
    onSelect: (Tab) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(PortfolioColors.Bg)
            .border(width = 1.dp, color = PortfolioColors.Line)
            .padding(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 4.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        for (tab in Tab.entries) {
            BottomNavItem(
                tab = tab,
                selected = tab == active,
                onClick = { onSelect(tab) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun BottomNavItem(
    tab: Tab,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val type = LocalPortfolioTypography.current
    val color = if (selected) PortfolioColors.Fg else PortfolioColors.Dim
    val interactionSource = remember { MutableInteractionSource() }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .clickable(
                interactionSource = interactionSource,
                indication = null, // no ripple — the design is quiet
                onClick = onClick,
            )
            .padding(vertical = 4.dp),
    ) {
        when (tab) {
            Tab.Portfolio -> PortfolioIcon(color)
            Tab.LastRun   -> LastRunIcon(color)
            Tab.Memo      -> MemoIcon(color)
            Tab.History   -> HistoryIcon(color)
            Tab.Settings  -> SettingsIcon(color)
        }
        Text(
            text = tab.label,
            style = type.microLabel.copy(
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            ),
            color = color,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
