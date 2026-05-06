package com.claudeportfolio.app.push

import android.app.PendingIntent
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.claudeportfolio.app.MainActivity
import com.claudeportfolio.app.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives data-only FCM payloads from the pipeline and surfaces them as
 * system notifications. All four payload kinds (`run_complete`,
 * `queued_for_review`, `briefing_error`, `run_failed`) are emitted by
 * `data-gatherers/lambda/fcmPublisher.js`.
 *
 * The service intentionally posts the notification ourselves rather than
 * relying on FCM's `notification` payload, because data-only delivery is
 * more reliable when the app is in the background and lets us pick our
 * own tap behaviour.
 */
class PushService : FirebaseMessagingService() {

    /**
     * Called whenever FCM rotates the device token. We let MainActivity
     * pick this up the next time it composes (the registration flow reads
     * the live token and POSTs it to /devices). Could also POST here, but
     * we'd need the bearer token from DataStore on a worker thread; the
     * activity-driven path is simpler and already runs on app resume.
     */
    override fun onNewToken(token: String) {
        Log.i(TAG, "FCM token rotated; will re-register on next launch.")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val kind = data["kind"] ?: return
        val runDate = data["runDate"]
        val (title, body) = renderPayload(kind, data)

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(PushConstants.EXTRA_KIND, kind)
            runDate?.let { putExtra(PushConstants.EXTRA_RUN_DATE, it) }
        }
        val pending = PendingIntent.getActivity(
            this,
            kind.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, PushConstants.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground) // launcher silhouette is fine
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .build()

        try {
            NotificationManagerCompat.from(this)
                .notify(notificationIdFor(kind, runDate), notification)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS not granted on Android 13+ — drop silently.
            // We'll request the permission when the user opens Settings.
            Log.w(TAG, "Couldn't post notification: ${e.message}")
        }
    }

    /** Title + body for each payload kind. */
    private fun renderPayload(kind: String, data: Map<String, String>): Pair<String, String> {
        val runDate = data["runDate"].orEmpty()
        return when (kind) {
            PushConstants.KIND_RUN_COMPLETE -> {
                val recCount = data["recCount"] ?: "?"
                val executed = data["executed"] ?: "0"
                val queued = data["queuedForReview"] ?: "0"
                val summary = data["summary"]?.takeIf { it.isNotBlank() }
                val sub = "$recCount recs · $executed executed · $queued queued"
                "Run complete · $runDate" to (summary ?: sub)
            }
            PushConstants.KIND_QUEUED_FOR_REVIEW -> {
                val n = data["count"] ?: "?"
                "Recommendations queued · $runDate" to
                    "$n recommendation${if (n == "1") "" else "s"} need your review."
            }
            PushConstants.KIND_BRIEFING_ERROR -> {
                val n = data["errorCount"] ?: "?"
                "Briefing errors · $runDate" to
                    "$n source error${if (n == "1") "" else "s"} during the briefing assembly."
            }
            PushConstants.KIND_RUN_FAILED -> {
                val err = data["error"]?.take(120) ?: "unknown error"
                "Pipeline failed · $runDate" to err
            }
            else -> "Claude Portfolio" to (data["text"] ?: kind)
        }
    }

    private fun notificationIdFor(kind: String, runDate: String?): Int {
        val seed = kind + (runDate ?: "")
        return seed.hashCode()
    }

    companion object {
        private const val TAG = "PushService"
    }
}
