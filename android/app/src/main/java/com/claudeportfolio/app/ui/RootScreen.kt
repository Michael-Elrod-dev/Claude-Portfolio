package com.claudeportfolio.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import com.claudeportfolio.app.ui.LocalIsLive
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.claudeportfolio.app.ui.components.PortfolioAppBar
import com.claudeportfolio.app.ui.components.PortfolioBottomNav
import com.claudeportfolio.app.ui.components.Tab
import com.claudeportfolio.app.ui.screens.HistoryScreen
import com.claudeportfolio.app.ui.screens.LastRunScreen
import com.claudeportfolio.app.ui.screens.MemoScreen
import com.claudeportfolio.app.ui.screens.PortfolioScreen
import com.claudeportfolio.app.ui.screens.RunDetailScreen
import com.claudeportfolio.app.ui.screens.SettingsScreen
import com.claudeportfolio.app.ui.theme.PortfolioColors

/**
 * Top-level scaffold:
 *   - PortfolioAppBar (title/eyebrow chosen by the active route)
 *   - NavHost in the middle
 *   - PortfolioBottomNav (selection chosen by the active route)
 *
 * Custom Column instead of Material `Scaffold` — the handoff explicitly
 * does NOT want Material's TopAppBar / NavigationBar chrome.
 *
 * Run detail is a nested route under History; the bottom nav still
 * highlights History while it's open, and the back gesture pops to it.
 */
@Composable
fun RootScreen(initialTab: com.claudeportfolio.app.ui.components.Tab? = null) {
    val navController = rememberNavController()

    // Honor a deep-link request from a notification tap. Runs once per
    // distinct initialTab value, so onNewIntent updates re-trigger it.
    LaunchedEffect(initialTab) {
        if (initialTab != null) {
            navController.navigate(initialTab.route) {
                popUpTo(navController.graph.startDestinationId) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        }
    }

    val backstackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backstackEntry?.destination?.route
    val currentArgs = backstackEntry?.arguments

    // Map current route → which bottom-nav tab should be highlighted.
    val activeTab = remember(currentRoute) {
        when {
            currentRoute == null -> Tab.Portfolio
            currentRoute.startsWith(RunDetailRoute.PREFIX) -> Tab.History
            else -> Tab.entries.firstOrNull { it.route == currentRoute } ?: Tab.Portfolio
        }
    }

    val barTitle = when {
        currentRoute?.startsWith(RunDetailRoute.PREFIX) == true -> "Run detail"
        else -> activeTab.label
    }

    val barEyebrow = eyebrowFor(activeTab, currentRoute, currentArgs?.getString("runDate"))
    val isLive = LocalIsLive.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(PortfolioColors.Bg),
    ) {
        PortfolioAppBar(
            eyebrow = barEyebrow,
            title = barTitle,
            statusLabel = if (isLive) "Live · paper acct" else "Mock data",
            statusOk = isLive,
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .weight(1f),
        ) {
            NavHost(
                navController = navController,
                startDestination = Tab.Portfolio.route,
            ) {
                composable(Tab.Portfolio.route) { PortfolioScreen() }
                composable(Tab.LastRun.route)   { LastRunScreen() }
                composable(Tab.Memo.route)      { MemoScreen() }
                composable(Tab.History.route)   {
                    HistoryScreen(onRunClick = { date ->
                        navController.navigate(RunDetailRoute.routeFor(date))
                    })
                }
                composable(Tab.Settings.route)  { SettingsScreen() }
                composable(
                    route = RunDetailRoute.PATTERN,
                    arguments = listOf(navArgument("runDate") { type = NavType.StringType }),
                ) { entry ->
                    val runDate = entry.arguments?.getString("runDate").orEmpty()
                    RunDetailScreen(runDate = runDate)
                }
            }
        }

        PortfolioBottomNav(
            active = activeTab,
            onSelect = { tab ->
                if (tab.route != currentRoute) {
                    navController.navigate(tab.route) {
                        // Tabs are siblings — pop everything above the start
                        // destination so back from any tab exits the app.
                        popUpTo(navController.graph.startDestinationId) {
                            saveState = true
                        }
                        launchSingleTop = true
                        restoreState = true
                    }
                }
            },
        )
    }
}

/**
 * Eyebrow text chosen per route. RunDetail uses the date arg; the five
 * tabs use placeholder strings the screens themselves can replace later
 * once they're driving from real data.
 */
private fun eyebrowFor(tab: Tab, route: String?, runDateArg: String?): String {
    if (route?.startsWith(RunDetailRoute.PREFIX) == true) {
        return runDateArg.orEmpty().uppercase().replace("-", " · ")
    }
    return when (tab) {
        Tab.Portfolio -> "SUN · MAY 3, 2026"
        Tab.LastRun   -> "MAY 3 · DRY-RUN"
        Tab.Memo      -> "UPDATED MAY 3"
        Tab.History   -> "8 WEEKLY RUNS"
        Tab.Settings  -> "BOT · PAPER ACCOUNT"
    }
}

object RunDetailRoute {
    const val PREFIX = "run_detail/"
    const val PATTERN = "run_detail/{runDate}"
    fun routeFor(runDate: String) = "run_detail/$runDate"
}
