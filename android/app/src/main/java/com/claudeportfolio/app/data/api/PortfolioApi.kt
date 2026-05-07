package com.claudeportfolio.app.data.api

import com.claudeportfolio.app.data.model.ActivityEvent
import com.claudeportfolio.app.data.model.BriefingPayload
import com.claudeportfolio.app.data.model.Flag
import com.claudeportfolio.app.data.model.Memo
import com.claudeportfolio.app.data.model.Portfolio
import com.claudeportfolio.app.data.model.RunListItem
import com.claudeportfolio.app.data.model.RunSummary

/**
 * Sole abstraction the screens depend on. Two implementations:
 *   - [RetrofitApi]      — real HTTPS calls to the API Gateway, used
 *                          whenever the user has saved a base URL +
 *                          bearer token in Settings → Connection.
 *   - [NotConnectedApi]  — fallback that throws on every method so the
 *                          screens render an explicit "Not connected"
 *                          banner instead of silently faking data.
 *
 * All methods are suspend so the real implementation can do network I/O
 * without blocking.
 */
interface PortfolioApi {

    suspend fun getPortfolio(): Portfolio

    suspend fun getMemo(): Memo

    suspend fun getRunsLatest(): RunSummary?

    suspend fun getRunByDate(runDate: String): RunSummary?

    suspend fun getRunsList(limit: Int = 20): List<RunListItem>

    suspend fun getBriefingLatest(): BriefingPayload?

    suspend fun getActivity(limit: Int = 50): List<ActivityEvent>

    suspend fun getFlagActive(): Flag

    suspend fun setFlagActive(value: Boolean): Flag

    suspend fun getFlagLive(): Flag

    suspend fun setFlagLive(value: Boolean): Flag

    suspend fun runForce()

    suspend fun registerDevice(token: String, platform: String = "android", appVersion: String? = null)
}
