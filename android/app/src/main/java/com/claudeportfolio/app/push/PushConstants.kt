package com.claudeportfolio.app.push

/**
 * Centralised IDs and intent action names shared between the FCM service,
 * the notification channel, and MainActivity's deep-link handling.
 */
object PushConstants {
    /** Channel id used for every push the app posts. */
    const val CHANNEL_ID = "claude_portfolio_runs"

    /** User-facing channel name (shown in system Settings → Notifications). */
    const val CHANNEL_NAME = "Run notifications"
    const val CHANNEL_DESCRIPTION = "Pings when a weekly run finishes, queues a recommendation, or fails."

    /**
     * Intent extra keys used when a notification tap launches MainActivity.
     * `EXTRA_KIND` matches the FCM `kind` payload, mirrored from
     * `data-gatherers/lambda/fcmPublisher.js::publish`.
     */
    const val EXTRA_KIND = "fcm_kind"
    const val EXTRA_RUN_DATE = "fcm_runDate"

    // The four notification kinds the backend emits — duplicated as
    // constants so screens can switch on them without sprinkling string
    // literals around.
    const val KIND_RUN_COMPLETE = "run_complete"
    const val KIND_QUEUED_FOR_REVIEW = "queued_for_review"
    const val KIND_BRIEFING_ERROR = "briefing_error"
    const val KIND_RUN_FAILED = "run_failed"
}
