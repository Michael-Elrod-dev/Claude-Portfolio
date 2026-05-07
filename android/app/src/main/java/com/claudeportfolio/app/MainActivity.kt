package com.claudeportfolio.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.claudeportfolio.app.data.api.ApiFactory
import com.claudeportfolio.app.data.api.NotConnectedApi
import com.claudeportfolio.app.data.api.PortfolioApi
import com.claudeportfolio.app.data.api.RetrofitApi
import com.claudeportfolio.app.data.config.ApiConfig
import com.claudeportfolio.app.data.config.ConfigStore
import com.claudeportfolio.app.push.PushConstants
import com.claudeportfolio.app.ui.LocalApi
import com.claudeportfolio.app.ui.LocalConfigStore
import com.claudeportfolio.app.ui.LocalEyebrows
import com.claudeportfolio.app.ui.LocalIsLive
import com.claudeportfolio.app.ui.LocalRefreshTick
import com.claudeportfolio.app.ui.RootScreen
import com.claudeportfolio.app.ui.components.Tab
import com.claudeportfolio.app.ui.theme.ClaudePortfolioTheme
import com.claudeportfolio.app.ui.theme.PortfolioColors
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import kotlin.coroutines.cancellation.CancellationException

/**
 * Single Activity. Reads the saved API config, picks Mock vs Retrofit
 * accordingly, registers the FCM token whenever config flips to
 * configured, and forwards notification-tap intents to the correct tab.
 */
class MainActivity : ComponentActivity() {

    /** Pending nav hint from a notification tap; consumed by RootScreen. */
    private var pendingTabFromIntent by mutableStateOf<Tab?>(null)

    /**
     * Bumped every time we see a push-tap intent. Screens use this as a
     * `rememberLoadable` key so the data on the destination tab refetches
     * even if the user was already sitting on it.
     */
    private var refreshTick by mutableStateOf(0)

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        android.util.Log.i("MainActivity", "POST_NOTIFICATIONS granted=$granted")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Pick up any nav target embedded by PushService.
        val tab = tabForIntent(intent)
        if (tab != null) {
            pendingTabFromIntent = tab
            refreshTick++
        }

        // Android 13+ requires runtime POST_NOTIFICATIONS for the system
        // to render any notification we post. Older versions auto-grant.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        val configStore = ConfigStore(applicationContext)

        setContent {
            // null = DataStore hasn't read yet. Render an empty dark
            // surface during the brief load so the screens never compose
            // with a stale "not configured" assumption — that was causing
            // a flash of "Not connected" on every cold start.
            val config by configStore.flow.collectAsState(initial = null)

            ClaudePortfolioTheme {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(PortfolioColors.Bg)
                        .windowInsetsPadding(WindowInsets.systemBars),
                    color = PortfolioColors.Bg,
                ) {
                    val cfg = config ?: return@Surface  // splash: empty Bg
                    AppContent(cfg, configStore)
                }
            }
        }
    }

    @Composable
    private fun AppContent(config: ApiConfig, configStore: ConfigStore) {
        val eyebrows = remember { androidx.compose.runtime.mutableStateMapOf<String, String>() }

        val api: PortfolioApi = remember(config.baseUrl, config.bearerToken) {
            if (config.isConfigured) {
                RetrofitApi(ApiFactory.build(config.baseUrl!!, config.bearerToken!!))
            } else NotConnectedApi
        }

        // Register the FCM token with /devices whenever we move from
        // unconfigured → configured, or when the saved config changes.
        LaunchedEffect(config.baseUrl, config.bearerToken) {
            if (config.isConfigured && isFirebaseAvailable()) {
                runCatching { registerFcmToken(api) }
                    .onFailure { e ->
                        if (e is CancellationException) throw e
                        android.util.Log.w("MainActivity",
                            "FCM token registration failed: ${e.message}")
                    }
            }
        }

        CompositionLocalProvider(
            LocalApi provides api,
            LocalIsLive provides config.isConfigured,
            LocalConfigStore provides configStore,
            LocalRefreshTick provides refreshTick,
            LocalEyebrows provides eyebrows,
        ) {
            // Pull the pending tab and clear it so a config-change
            // recomposition doesn't re-navigate.
            val initialTab = pendingTabFromIntent
            LaunchedEffect(initialTab) {
                if (initialTab != null) pendingTabFromIntent = null
            }
            RootScreen(initialTab = initialTab)
        }
    }

    /**
     * Called when the activity already exists and a notification tap
     * brings it to the front. Update the pending tab so RootScreen
     * navigates again.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        tabForIntent(intent)?.let {
            pendingTabFromIntent = it
            refreshTick++
        }
    }

    private fun tabForIntent(intent: Intent?): Tab? {
        val kind = intent?.getStringExtra(PushConstants.EXTRA_KIND) ?: return null
        return when (kind) {
            PushConstants.KIND_RUN_COMPLETE,
            PushConstants.KIND_QUEUED_FOR_REVIEW -> Tab.LastRun
            PushConstants.KIND_BRIEFING_ERROR,
            PushConstants.KIND_RUN_FAILED -> Tab.Settings
            else -> null
        }
    }

    /** True when Firebase auto-init succeeded (i.e. google-services.json was present at build). */
    private fun isFirebaseAvailable(): Boolean = try {
        FirebaseApp.getInstance() != null
    } catch (_: IllegalStateException) {
        false
    }

    private suspend fun registerFcmToken(api: PortfolioApi) {
        val token = FirebaseMessaging.getInstance().token.await()
        val versionName = packageManager
            .getPackageInfo(packageName, 0).versionName
        api.registerDevice(token = token, platform = "android", appVersion = versionName)
    }
}

