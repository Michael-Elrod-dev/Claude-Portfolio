package com.claudeportfolio.app.ui

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.staticCompositionLocalOf
import com.claudeportfolio.app.data.api.PortfolioApi
import com.claudeportfolio.app.data.config.ConfigStore

/**
 * Provides the [PortfolioApi] to every composable. MainActivity provides
 * a [com.claudeportfolio.app.data.api.RetrofitApi] when the user is
 * configured, otherwise a [com.claudeportfolio.app.data.api.NotConnectedApi]
 * that throws — the error path on each screen renders a clear "Not
 * connected" banner instead of silently showing fake data.
 *
 * Default of `error()` here ensures we never accidentally fall back to
 * something silently — every consumer must be wrapped in a
 * CompositionLocalProvider in MainActivity.
 */
val LocalApi = staticCompositionLocalOf<PortfolioApi> {
    error("LocalApi not provided. Wrap in CompositionLocalProvider in MainActivity.")
}

/**
 * True iff the app has saved API config and is talking to the real
 * backend. The status pill in the AppBar reads this to flip between
 * "Live · paper acct" (green) and "Not connected" (red).
 */
val LocalIsLive = staticCompositionLocalOf { false }

/**
 * Single ConfigStore instance for the whole app — exposed so the Settings
 * screen can save/clear credentials without going through the API layer.
 */
val LocalConfigStore = staticCompositionLocalOf<ConfigStore> {
    error("LocalConfigStore not provided. Wrap in CompositionLocalProvider in MainActivity.")
}

/**
 * Bump-on-event counter. Screens pass `LocalRefreshTick.current` as a
 * key to their `rememberLoadable` so they refetch when the tick changes.
 *
 * Currently bumped in MainActivity when the activity is launched/resumed
 * via a notification tap — that way landing on a tab from a push always
 * shows fresh data, even if you were already sitting on it.
 */
val LocalRefreshTick = staticCompositionLocalOf { 0 }

/**
 * Shared mutable string the AppBar reads for its eyebrow line. Each
 * screen updates this from a [androidx.compose.runtime.LaunchedEffect]
 * keyed on its loaded data, so the eyebrow always reflects what's
 * actually on screen instead of a hard-coded handoff string.
 */
val LocalEyebrow = staticCompositionLocalOf<MutableState<String>> {
    mutableStateOf("")
}
