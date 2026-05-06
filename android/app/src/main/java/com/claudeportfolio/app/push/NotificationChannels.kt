package com.claudeportfolio.app.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.content.getSystemService

/**
 * Idempotent. Creates the run-notifications channel if it doesn't already
 * exist. Called once from [com.claudeportfolio.app.PortfolioApp.onCreate].
 *
 * Channel registration is required from Android 8 (API 26) onward, and our
 * `minSdk = 26`, so we skip the version guard. Importance is `DEFAULT`
 * which buzzes once (no heads-up, no full-screen) — matches the handoff's
 * preference for a quiet design.
 */
fun ensureNotificationChannel(context: Context) {
    val mgr = context.getSystemService<NotificationManager>() ?: return
    if (mgr.getNotificationChannel(PushConstants.CHANNEL_ID) != null) return
    val channel = NotificationChannel(
        PushConstants.CHANNEL_ID,
        PushConstants.CHANNEL_NAME,
        NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
        description = PushConstants.CHANNEL_DESCRIPTION
    }
    mgr.createNotificationChannel(channel)
}
