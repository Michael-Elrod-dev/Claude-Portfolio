package com.claudeportfolio.app

import android.app.Application
import com.claudeportfolio.app.push.ensureNotificationChannel

/**
 * Application entry point. Registers the notification channel once at
 * process start so any push that arrives later finds it ready.
 */
class PortfolioApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel(this)
    }
}
