package com.claudeportfolio.app.data.api

import com.claudeportfolio.app.data.model.ActivityEvent
import com.claudeportfolio.app.data.model.BriefingPayload
import com.claudeportfolio.app.data.model.Flag
import com.claudeportfolio.app.data.model.Memo
import com.claudeportfolio.app.data.model.Portfolio
import com.claudeportfolio.app.data.model.RunListItem
import com.claudeportfolio.app.data.model.RunSummary

/**
 * The [PortfolioApi] backed-by-nothing implementation that MainActivity
 * provides whenever the user hasn't entered API credentials. Every method
 * throws [NotConnectedException]; the screens' error path catches it and
 * renders a clear "Not connected" banner.
 *
 * This replaces the old MockApi fallback. The app should never silently
 * show fake data — when it can't reach the real backend, that should be
 * obvious in the UI.
 */
class NotConnectedException : Exception(
    "Not connected. Open Settings → Connection to enter your API URL and bearer token."
)

object NotConnectedApi : PortfolioApi {
    override suspend fun getPortfolio(): Portfolio = throw NotConnectedException()
    override suspend fun getMemo(): Memo = throw NotConnectedException()
    override suspend fun getRunsLatest(): RunSummary? = throw NotConnectedException()
    override suspend fun getRunByDate(runDate: String): RunSummary? = throw NotConnectedException()
    override suspend fun getRunsList(limit: Int): List<RunListItem> = throw NotConnectedException()
    override suspend fun getBriefingLatest(): BriefingPayload? = throw NotConnectedException()
    override suspend fun getActivity(limit: Int): List<ActivityEvent> = throw NotConnectedException()
    override suspend fun getFlagActive(): Flag = throw NotConnectedException()
    override suspend fun setFlagActive(value: Boolean): Flag = throw NotConnectedException()
    override suspend fun getFlagLive(): Flag = throw NotConnectedException()
    override suspend fun setFlagLive(value: Boolean): Flag = throw NotConnectedException()
    override suspend fun runForce() = throw NotConnectedException()
    override suspend fun registerDevice(token: String, platform: String, appVersion: String?) =
        throw NotConnectedException()
}
