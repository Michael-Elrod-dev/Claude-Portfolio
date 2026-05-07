package com.claudeportfolio.app.ui

import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.runtime.mutableStateMapOf
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
 * Per-tab eyebrow cache. Each screen writes its eyebrow text into its
 * own slot (`eyebrows["Portfolio"] = ...`); the AppBar reads whichever
 * slot matches the currently-visible tab. Using a map (instead of a
 * single MutableState<String>) means swiping the HorizontalPager back
 * to a previously-loaded tab still shows the right eyebrow without
 * triggering a re-fetch.
 *
 * Keys are the [com.claudeportfolio.app.ui.components.Tab.name] values
 * plus a special "run_detail" key for the pushed RunDetail route.
 */
val LocalEyebrows = staticCompositionLocalOf<SnapshotStateMap<String, String>> {
    mutableStateMapOf()
}
