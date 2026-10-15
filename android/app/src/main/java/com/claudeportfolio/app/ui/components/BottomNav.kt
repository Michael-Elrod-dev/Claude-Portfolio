package com.claudeportfolio.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudeportfolio.app.ui.theme.KilnColors
import com.claudeportfolio.app.ui.theme.KilnSpace
import com.claudeportfolio.app.ui.theme.LocalKilnTypography

/**
 * The five top-level tabs.
 *
 * Order is fixed: Portfolio · Last run · Memo · History · Settings.
 */
enum class Tab(val route: String, val label: String) {
    Portfolio("portfolio", "Portfolio"),
    LastRun("last_run", "Last run"),
    Memo("memo", "Memo"),
    History("history", "History"),
    Settings("settings", "Settings"),
}

/**
 * Bottom nav, Kiln-styled.
 *
 * Kiln's desktop equivalent is a 64px icon rail with 10px-radius items; this
 * is its phone form. The active tab is clay — Kiln reserves its one saturated
 * colour for "the live thing", and which tab you are on qualifies. Inactive
 * is [KilnColors.textTertiary].
 *
 * There is no selected-indicator pill and no ripple: pills in Kiln report
 * state on content, not navigation chrome, and the system has no entrance
 * animations by design.
 */
@Composable
fun PortfolioBottomNav(
    active: Tab,
    onSelect: (Tab) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(KilnColors.surfaceChrome),
    ) {
        HairlineDivider(color = KilnColors.hairlineStructural)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = KilnSpace.s3, vertical = KilnSpace.s4),
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
}

@Composable
private fun BottomNavItem(
    tab: Tab,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val type = LocalKilnTypography.current
    val color = if (selected) KilnColors.accentHover else KilnColors.textTertiary
    val interactionSource = remember { MutableInteractionSource() }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = modifier
            .heightIn(min = KilnSpace.hitMobile)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick,
            )
            .padding(vertical = KilnSpace.s4),
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
            style = type.outcome,
            color = color,
            modifier = Modifier.padding(top = 3.dp),
        )
    }
}
