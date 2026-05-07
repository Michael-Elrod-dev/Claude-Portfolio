package com.claudeportfolio.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
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
import kotlinx.coroutines.launch

private const val TABS_ROUTE = "tabs"

/**
 * Top-level scaffold:
 *   - PortfolioAppBar (eyebrow + title + status pill)
 *   - NavHost with two destinations:
 *       1. "tabs" — a HorizontalPager over the 5 tab screens
 *       2. "run_detail/{date}" — pushed from the History tab
 *   - PortfolioBottomNav (active tab derived from the pager, or History
 *     when on RunDetail)
 *
 * Tab navigation works two ways: tap a bottom-nav icon (animates the
 * pager to that page) or swipe horizontally between screens. Both
 * inputs share the same pagerState so they stay in sync.
 */
@Composable
fun RootScreen(initialTab: Tab? = null) {
    val navController = rememberNavController()
    val pagerState = rememberPagerState(pageCount = { Tab.entries.size })
    val coroutineScope = rememberCoroutineScope()

    // Notification-tap deep link: animate to the requested tab. If we're
    // currently on RunDetail, pop back to the pager first.
    LaunchedEffect(initialTab) {
        if (initialTab != null) {
            val backstackTop = navController.currentBackStackEntry?.destination?.route
            if (backstackTop?.startsWith(RunDetailRoute.PREFIX) == true) {
                navController.popBackStack()
            }
            pagerState.animateScrollToPage(initialTab.ordinal)
        }
    }

    val backstackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backstackEntry?.destination?.route
    val currentArgs = backstackEntry?.arguments
    val isRunDetail = currentRoute?.startsWith(RunDetailRoute.PREFIX) == true

    val activeTab = if (isRunDetail) Tab.History else Tab.entries[pagerState.currentPage]
    val barTitle = if (isRunDetail) "Run detail" else activeTab.label

    val eyebrows = LocalEyebrows.current
    // RunDetail's eyebrow is derived synchronously from the route arg —
    // no API call needed, so push it into the cache directly.
    val runDateArg = currentArgs?.getString("runDate")
    LaunchedEffect(currentRoute, runDateArg) {
        if (isRunDetail && !runDateArg.isNullOrBlank()) {
            eyebrows["run_detail"] = runDateArg.uppercase().replace("-", " · ")
        }
    }
    val activeEyebrowKey = if (isRunDetail) "run_detail" else activeTab.name
    val activeEyebrow = eyebrows[activeEyebrowKey] ?: ""
    val isLive = LocalIsLive.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(PortfolioColors.Bg),
    ) {
        PortfolioAppBar(
            eyebrow = activeEyebrow,
            title = barTitle,
            statusLabel = if (isLive) "Live · paper acct" else "Not connected",
            statusOk = isLive,
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .weight(1f),
        ) {
            NavHost(
                navController = navController,
                startDestination = TABS_ROUTE,
            ) {
                composable(TABS_ROUTE) {
                    HorizontalPager(
                        state = pagerState,
                        modifier = Modifier.fillMaxSize(),
                    ) { page ->
                        when (Tab.entries[page]) {
                            Tab.Portfolio -> PortfolioScreen()
                            Tab.LastRun   -> LastRunScreen()
                            Tab.Memo      -> MemoScreen()
                            Tab.History   -> HistoryScreen(onRunClick = { date ->
                                navController.navigate(RunDetailRoute.routeFor(date))
                            })
                            Tab.Settings  -> SettingsScreen()
                        }
                    }
                }
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
                // If we're on RunDetail, pop back to the pager first.
                if (isRunDetail) {
                    navController.popBackStack(TABS_ROUTE, inclusive = false)
                }
                coroutineScope.launch {
                    pagerState.animateScrollToPage(tab.ordinal)
                }
            },
        )
    }
}

object RunDetailRoute {
    const val PREFIX = "run_detail/"
    const val PATTERN = "run_detail/{runDate}"
    fun routeFor(runDate: String) = "run_detail/$runDate"
}
