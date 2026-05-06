package com.claudeportfolio.app.data.api

import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Builds a [PortfolioService] for a given base URL + bearer token.
 *
 * Each new (baseUrl, token) pair creates a fresh OkHttp + Retrofit stack —
 * the user reconfigures rarely so this is fine. Avoids any threading
 * concerns around mutating an interceptor's state.
 *
 * Notes:
 *   - JSON config tolerates unknown fields so the server can add new
 *     properties without breaking older clients.
 *   - HttpLoggingInterceptor at BASIC for debug visibility. We don't ship
 *     a release build to the Play Store so this stays on; if that ever
 *     changes, gate it behind BuildConfig.DEBUG.
 *   - Read timeout is 30s — the slowest endpoint (`/portfolio`) hits
 *     Alpaca's portfolio-history + order-history and can be ~3s on cold
 *     start. 30s gives plenty of headroom.
 */
object ApiFactory {

    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    fun build(baseUrl: String, bearerToken: String): PortfolioService {
        val cleanBase = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"

        val authInterceptor = okhttp3.Interceptor { chain ->
            val req = chain.request().newBuilder()
                .header("Authorization", "Bearer $bearerToken")
                .header("Accept", "application/json")
                .build()
            chain.proceed(req)
        }

        val logging = HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC }

        val client = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(45, TimeUnit.SECONDS)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(cleanBase)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()

        return retrofit.create(PortfolioService::class.java)
    }
}
