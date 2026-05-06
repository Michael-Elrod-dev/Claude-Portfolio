package com.claudeportfolio.app.data.config

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Persisted bearer token + base URL for the API. Stored via DataStore
 * Preferences (not Encrypted) — bearer token is essentially a password.
 *
 * For a personal sideloaded app on a phone the user controls, the threat
 * model is: someone gets physical access to the phone. DataStore
 * preferences are stored under the app's private data directory (mode
 * 0700) and are not readable by other apps. That's enough for our case.
 *
 * If we ever ship to multiple users we should switch to
 * `EncryptedSharedPreferences` or DataStore + Tink — flagged as TODO.
 */

// File name on disk: <package>/files/datastore/portfolio_config.preferences_pb
private val Context.configDataStore by preferencesDataStore("portfolio_config")

private val KEY_BASE_URL = stringPreferencesKey("base_url")
private val KEY_BEARER_TOKEN = stringPreferencesKey("bearer_token")

data class ApiConfig(
    val baseUrl: String?,
    val bearerToken: String?,
) {
    val isConfigured: Boolean
        get() = !baseUrl.isNullOrBlank() && !bearerToken.isNullOrBlank()
}

class ConfigStore(private val context: Context) {

    val flow: Flow<ApiConfig> = context.configDataStore.data.map { prefs ->
        ApiConfig(
            baseUrl = prefs[KEY_BASE_URL]?.takeIf { it.isNotBlank() },
            bearerToken = prefs[KEY_BEARER_TOKEN]?.takeIf { it.isNotBlank() },
        )
    }

    suspend fun save(baseUrl: String, bearerToken: String) {
        context.configDataStore.edit { prefs ->
            prefs[KEY_BASE_URL] = baseUrl.trim()
            prefs[KEY_BEARER_TOKEN] = bearerToken.trim()
        }
    }

    suspend fun clear() {
        context.configDataStore.edit { it.clear() }
    }
}
