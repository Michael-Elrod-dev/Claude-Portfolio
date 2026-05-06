package com.claudeportfolio.app.ui

import androidx.compose.runtime.staticCompositionLocalOf
import com.claudeportfolio.app.data.api.MockApi
import com.claudeportfolio.app.data.api.PortfolioApi
import com.claudeportfolio.app.data.config.ConfigStore

/**
 * Provides the active [PortfolioApi] (Mock or Retrofit-backed) to every
 * composable. Set in [MainActivity] by reading the [ConfigStore] flow:
 *   - configured  → RetrofitApi
 *   - unconfigured → MockApi (the screens still work; banners show "MOCK")
 */
val LocalApi = staticCompositionLocalOf<PortfolioApi> { MockApi() }

/**
 * Whether the app is talking to the real API. False = MockApi, surface
 * a "MOCK" indicator in the status pill so it's obvious what you're
 * looking at.
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
