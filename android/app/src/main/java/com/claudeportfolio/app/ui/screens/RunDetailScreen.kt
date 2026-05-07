@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.claudeportfolio.app.ui.screens

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.claudeportfolio.app.ui.LocalApi
import com.claudeportfolio.app.ui.LocalRefreshTick
import com.claudeportfolio.app.ui.UiState
import com.claudeportfolio.app.ui.rememberLoadable

/**
 * Pushed from [HistoryScreen] when the user taps a run row. Same body as
 * [LastRunScreen] but parameterized by date — the handoff specifically
 * calls this out as a route variant rather than a separately-wireframed
 * screen.
 */
@Composable
fun RunDetailScreen(runDate: String) {
    val api = LocalApi.current
    val tick = LocalRefreshTick.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var isRefreshing by remember { mutableStateOf(false) }
    val state = rememberLoadable(runDate, tick, refreshKey) { api.getRunByDate(runDate) }
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
            is UiState.Loading -> com.claudeportfolio.app.ui.components.LastRunSkeleton()
            is UiState.Error   -> ErrorBanner(state.message)
            is UiState.Ready   -> {
                val run = state.data
                if (run == null) ErrorBanner("No run for $runDate.") else RunBody(run)
            }
        }
    }
}
