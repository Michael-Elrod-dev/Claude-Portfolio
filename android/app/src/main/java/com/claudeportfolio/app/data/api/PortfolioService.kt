package com.claudeportfolio.app.data.api

import com.claudeportfolio.app.data.model.ActivityEvent
import com.claudeportfolio.app.data.model.BriefingPayload
import com.claudeportfolio.app.data.model.Flag
import com.claudeportfolio.app.data.model.Memo
import com.claudeportfolio.app.data.model.Portfolio
import com.claudeportfolio.app.data.model.RunListItem
import com.claudeportfolio.app.data.model.RunSummary
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Retrofit interface mirroring the API Lambda's routes. Responses come
 * wrapped in small envelopes (e.g. `{"memo": {...}}`) — [RetrofitApi]
 * unwraps them so the rest of the app sees plain domain types.
 *
 * Bearer-token auth is added by an OkHttp interceptor in [ApiFactory], so
 * none of the methods here need to take a token argument.
 */
interface PortfolioService {

    @GET("portfolio")
    suspend fun getPortfolio(): Portfolio

    @GET("memo")
    suspend fun getMemo(): MemoEnvelope

    @GET("runs/latest")
    suspend fun getRunsLatest(): RunEnvelope

    @GET("runs/{date}")
    suspend fun getRunByDate(@Path("date") runDate: String): RunEnvelope

    @GET("runs")
    suspend fun getRunsList(@Query("limit") limit: Int): RunsListEnvelope

    @GET("briefing/latest")
    suspend fun getBriefingLatest(): BriefingPayload

    @GET("activity")
    suspend fun getActivity(@Query("limit") limit: Int): ActivityEnvelope

    @GET("flags/active")
    suspend fun getFlagActive(): Flag

    @PUT("flags/active")
    suspend fun setFlagActive(@Body body: FlagBody): Flag

    @GET("flags/live")
    suspend fun getFlagLive(): Flag

    @PUT("flags/live")
    suspend fun setFlagLive(@Body body: FlagBody): Flag

    @POST("run/force")
    suspend fun runForce(): RunForceResponse

    @POST("devices")
    suspend fun registerDevice(@Body body: DeviceBody): RegisteredResponse
}

// ── Envelopes ───────────────────────────────────────────────────────────

@Serializable data class MemoEnvelope(val memo: Memo)
@Serializable data class RunEnvelope(val run: RunSummary)
@Serializable data class RunsListEnvelope(val runs: List<RunListItem>, val total: Int = 0)
@Serializable data class ActivityEnvelope(val events: List<ActivityEvent>)

@Serializable data class FlagBody(val value: Boolean)
@Serializable data class DeviceBody(
    val token: String,
    val platform: String = "android",
    val appVersion: String? = null,
)

@Serializable data class RunForceResponse(
    val status: String? = null,
    val forced: Boolean = false,
)
@Serializable data class RegisteredResponse(val registered: Boolean = false)
