package com.claudeportfolio.app.data.api

import com.claudeportfolio.app.data.model.ActivityEvent
import com.claudeportfolio.app.data.model.BriefingPayload
import com.claudeportfolio.app.data.model.Flag
import com.claudeportfolio.app.data.model.Memo
import com.claudeportfolio.app.data.model.Portfolio
import com.claudeportfolio.app.data.model.RunListItem
import com.claudeportfolio.app.data.model.RunSummary
import retrofit2.HttpException

/**
 * [PortfolioApi] implementation backed by Retrofit. Wraps a
 * [PortfolioService] (HTTP) and unwraps the small envelope objects so the
 * rest of the app sees plain domain types.
 *
 * 404 from /runs/latest, /runs/{date}, and /briefing/latest is treated as
 * "no run yet" and surfaced as null. Other HTTP errors throw — UiState in
 * the screens turns them into the error banner.
 */
class RetrofitApi(private val service: PortfolioService) : PortfolioApi {

    override suspend fun getPortfolio(): Portfolio = service.getPortfolio()

    override suspend fun getMemo(): Memo = service.getMemo().memo

    override suspend fun getRunsLatest(): RunSummary? = nullOn404 { service.getRunsLatest().run }

    override suspend fun getRunByDate(runDate: String): RunSummary? =
        nullOn404 { service.getRunByDate(runDate).run }

    override suspend fun getRunsList(limit: Int): List<RunListItem> =
        service.getRunsList(limit).runs

    override suspend fun getBriefingLatest(): BriefingPayload? =
        nullOn404 { service.getBriefingLatest() }

    override suspend fun getActivity(limit: Int): List<ActivityEvent> =
        service.getActivity(limit).events

    override suspend fun getFlagActive(): Flag = service.getFlagActive()
    override suspend fun setFlagActive(value: Boolean): Flag =
        service.setFlagActive(FlagBody(value))

    override suspend fun getFlagLive(): Flag = service.getFlagLive()
    override suspend fun setFlagLive(value: Boolean): Flag =
        service.setFlagLive(FlagBody(value))

    override suspend fun runForce() {
        service.runForce()
    }

    override suspend fun registerDevice(token: String, platform: String, appVersion: String?) {
        service.registerDevice(DeviceBody(token, platform, appVersion))
    }

    private suspend inline fun <T> nullOn404(crossinline block: suspend () -> T): T? = try {
        block()
    } catch (e: HttpException) {
        if (e.code() == 404) null else throw e
    }
}
