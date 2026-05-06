package com.claudeportfolio.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/**
 * Three-state envelope every screen wraps its data in. Phase 4 mock data
 * makes Loading effectively instant and never produces Error, but the
 * envelope is in place so Phase 5 can plug in real network calls without
 * restructuring screens.
 */
sealed class UiState<out T> {
    data object Loading : UiState<Nothing>()
    data class Ready<T>(val data: T) : UiState<T>()
    data class Error(val message: String) : UiState<Nothing>()
}

/**
 * One-shot async loader. Calls [load] inside a [LaunchedEffect] and tracks
 * the result as a UiState. Multiple keys can be passed — e.g. a global
 * "refresh tick" plus a screen-local pull-to-refresh counter — and the
 * load re-runs whenever any of them changes.
 */
@Composable
fun <T> rememberLoadable(
    vararg keys: Any?,
    load: suspend () -> T,
): UiState<T> {
    val state: MutableState<UiState<T>> = remember(*keys) { mutableStateOf(UiState.Loading) }
    LaunchedEffect(keys = keys) {
        state.value = try {
            UiState.Ready(load())
        } catch (e: Exception) {
            UiState.Error(e.message ?: e.javaClass.simpleName)
        }
    }
    return state.value
}
