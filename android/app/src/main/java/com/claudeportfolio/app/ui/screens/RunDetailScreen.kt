package com.claudeportfolio.app.ui.screens

import androidx.compose.runtime.Composable
import com.claudeportfolio.app.ui.LocalApi
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
    val state = rememberLoadable(runDate) { api.getRunByDate(runDate) }

    when (state) {
        is UiState.Loading -> com.claudeportfolio.app.ui.components.LastRunSkeleton()
        is UiState.Error   -> ErrorBanner(state.message)
        is UiState.Ready   -> {
            val run = state.data
            if (run == null) ErrorBanner("No run for $runDate.") else RunBody(run)
        }
    }
}
