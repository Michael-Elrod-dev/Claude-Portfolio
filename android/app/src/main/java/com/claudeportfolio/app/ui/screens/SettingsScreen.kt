@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.claudeportfolio.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.claudeportfolio.app.data.model.ActivityEvent
import com.claudeportfolio.app.data.model.BriefingPayload
import com.claudeportfolio.app.ui.LocalApi
import com.claudeportfolio.app.ui.LocalConfigStore
import com.claudeportfolio.app.ui.LocalEyebrows
import com.claudeportfolio.app.ui.LocalIsLive
import com.claudeportfolio.app.ui.LocalRefreshTick
import com.claudeportfolio.app.ui.components.ButtonKind
import com.claudeportfolio.app.ui.components.DotState
import com.claudeportfolio.app.ui.components.HairlineDivider
import com.claudeportfolio.app.ui.components.KilnBanner
import com.claudeportfolio.app.ui.components.KilnButton
import com.claudeportfolio.app.ui.components.KilnCard
import com.claudeportfolio.app.ui.components.KilnDot
import com.claudeportfolio.app.ui.components.KilnField
import com.claudeportfolio.app.ui.components.KilnSwitch
import com.claudeportfolio.app.ui.components.SectionLabel
import com.claudeportfolio.app.ui.components.Tone
import com.claudeportfolio.app.ui.format.fmtAgo
import com.claudeportfolio.app.ui.theme.KilnColors
import com.claudeportfolio.app.ui.theme.KilnRadius
import com.claudeportfolio.app.ui.theme.KilnSpace
import com.claudeportfolio.app.ui.theme.LocalKilnTypography
import com.claudeportfolio.app.ui.theme.metaMonoSmall
import com.claudeportfolio.app.ui.theme.smallBody
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Settings, in Kiln. Four cards: Connection, Bot controls, Briefing, Activity.
 *
 * The active flag is the system's only kill switch, so its row carries a
 * live/dead [KilnDot] and the force-run button
 * is the danger variant — a forced run places real orders on the live
 * account and nothing downstream will stop it.
 *
 * URLs, tokens, timestamps and the briefing JSON are machine-owned text, so
 * they render in mono per Kiln's family split.
 */
@Composable
fun SettingsScreen() {
    val api = LocalApi.current
    val type = LocalKilnTypography.current

    val activeFlag = remember { mutableStateOf<Boolean?>(null) }
    val activity = remember { mutableStateOf<List<ActivityEvent>>(emptyList()) }
    val briefing = remember { mutableStateOf<BriefingPayload?>(null) }
    var briefingExpanded by remember { mutableStateOf(false) }
    var pendingForceRun by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()
    val tick = LocalRefreshTick.current
    val eyebrows = LocalEyebrows.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var isRefreshing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        eyebrows["Settings"] = "BOT · LIVE ACCOUNT"
    }
    LaunchedEffect(api, tick, refreshKey) {
        // Settings is the one screen that must work while disconnected (so
        // the Connection form can be filled in), so every call is isolated
        // and a failure in one doesn't poison the others.
        runCatching { activeFlag.value = api.getFlagActive().value }
            .onFailure { activeFlag.value = null }
        runCatching { activity.value = api.getActivity(limit = 30) }
            .onFailure { activity.value = emptyList() }
        runCatching { briefing.value = api.getBriefingLatest() }
            .onFailure { briefing.value = null }
        isRefreshing = false
    }

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            isRefreshing = true
            refreshKey++
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(KilnColors.surfaceApp)
                .verticalScroll(rememberScrollState())
                .padding(
                    start = KilnSpace.padScreenH,
                    end = KilnSpace.padScreenH,
                    top = KilnSpace.padScreenV,
                    bottom = KilnSpace.s18,
                ),
        ) {
            // ── Connection ───────────────────────────────────────────────
            GroupLabel("Connection")
            ConnectionCard()
            Spacer(Modifier.height(KilnSpace.gapSection))

            // ── Bot controls ─────────────────────────────────────────────
            GroupLabel("Bot controls")
            KilnCard {
                SettingRow(
                    title = "Active",
                    hint = "SSM claude-portfolio-active · the only trading gate",
                    leading = {
                        KilnDot(
                            state = when (activeFlag.value) {
                                true -> DotState.Live
                                false -> DotState.Dead
                                null -> DotState.Idle
                            },
                        )
                    },
                    trailing = {
                        KilnSwitch(
                            checked = activeFlag.value == true,
                            enabled = activeFlag.value != null,
                            onChange = { newValue ->
                                scope.launch {
                                    runCatching { api.setFlagActive(newValue).value }
                                        .onSuccess { activeFlag.value = it }
                                }
                            },
                        )
                    },
                )
                HairlineDivider(color = KilnColors.hairlineRow)
                SettingRow(
                    title = "Force run now",
                    hint = "Bypasses the active flag · places real orders",
                    trailing = {
                        KilnButton(
                            label = "Run",
                            kind = ButtonKind.Danger,
                            small = true,
                            onClick = { pendingForceRun = true },
                        )
                    },
                )
            }
            Spacer(Modifier.height(KilnSpace.gapSection))

            // ── Briefing ─────────────────────────────────────────────────
            GroupLabel("Latest briefing")
            BriefingCard(
                briefing = briefing.value,
                expanded = briefingExpanded,
                onToggle = { briefingExpanded = !briefingExpanded },
            )
            Spacer(Modifier.height(KilnSpace.gapSection))

            // ── Activity ─────────────────────────────────────────────────
            GroupLabel("Recent activity")
            KilnCard {
                if (activity.value.isEmpty()) {
                    Text(
                        text = "No activity yet.",
                        style = type.smallBody,
                        color = KilnColors.textTertiary,
                        modifier = Modifier.padding(KilnSpace.padCard),
                    )
                } else {
                    activity.value.forEachIndexed { i, event ->
                        ActivityRow(event, divider = i != activity.value.lastIndex)
                    }
                }
            }
        }
    }

    if (pendingForceRun) {
        AlertDialog(
            onDismissRequest = { pendingForceRun = false },
            shape = KilnRadius.dialog,
            containerColor = KilnColors.surfaceCard,
            tonalElevation = 0.dp,
            modifier = Modifier.border(KilnSpace.hairline, KilnColors.dangerBorder, KilnRadius.dialog),
            title = {
                Text("Run the pipeline now?", style = type.dialogTitle, color = KilnColors.textPrimary)
            },
            text = {
                Text(
                    text = "This bypasses the active flag and places REAL orders on your live " +
                        "account. There is no dry run. The pipeline takes 5–10 minutes.",
                    style = type.smallBody,
                    color = KilnColors.textSecondary,
                )
            },
            confirmButton = {
                KilnButton(
                    label = "Place real orders",
                    kind = ButtonKind.Danger,
                    onClick = {
                        pendingForceRun = false
                        scope.launch { runCatching { api.runForce() } }
                    },
                )
            },
            dismissButton = {
                KilnButton(
                    label = "Cancel",
                    kind = ButtonKind.Text,
                    onClick = { pendingForceRun = false },
                )
            },
        )
    }
}

// ── Pieces ────────────────────────────────────────────────────────────────

@Composable
private fun GroupLabel(text: String) {
    SectionLabel(text, modifier = Modifier.padding(bottom = KilnSpace.s7))
}

@Composable
private fun SettingRow(
    title: String,
    hint: String,
    leading: (@Composable () -> Unit)? = null,
    trailing: @Composable () -> Unit,
) {
    val type = LocalKilnTypography.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = KilnSpace.hitMobile)
            .padding(horizontal = KilnSpace.padCard, vertical = KilnSpace.s8),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.width(KilnSpace.s6))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = type.rowTitle, color = KilnColors.textPrimary)
            Spacer(Modifier.height(KilnSpace.s1))
            Text(hint, style = type.metaMonoSmall, color = KilnColors.textTertiary)
        }
        Spacer(Modifier.width(KilnSpace.s8))
        trailing()
    }
}

@Composable
private fun BriefingCard(
    briefing: BriefingPayload?,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
    val type = LocalKilnTypography.current
    val symCount = (briefing?.briefing?.get("symbolsCovered") as? JsonArray)?.size
    KilnCard {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = KilnSpace.hitMobile)
                .padding(horizontal = KilnSpace.padCard, vertical = KilnSpace.s8),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = briefing?.runDate ?: "No briefing",
                    style = type.rowTitle.copy(fontFamily = type.metaMono.fontFamily),
                    color = KilnColors.textPrimary,
                )
                Spacer(Modifier.height(KilnSpace.s1))
                Text(
                    text = if (symCount == null) "—" else "$symCount symbols covered",
                    style = type.metaMonoSmall,
                    color = KilnColors.textTertiary,
                )
            }
            KilnButton(
                label = if (expanded) "Hide JSON" else "Inspect",
                kind = ButtonKind.Ghost,
                small = true,
                enabled = briefing != null,
                onClick = onToggle,
            )
        }
        if (expanded && briefing != null) {
            HairlineDivider()
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 320.dp)
                    .background(KilnColors.surfaceInset)
                    .verticalScroll(rememberScrollState())
                    .padding(KilnSpace.s8),
            ) {
                Text(
                    text = prettyPrintJson(briefing.briefing),
                    style = type.metaMonoSmall,
                    color = KilnColors.textSecondary,
                )
            }
        }
    }
}

@Composable
private fun ActivityRow(event: ActivityEvent, divider: Boolean) {
    val type = LocalKilnTypography.current
    val text = (event.payload["text"] as? JsonPrimitive)?.contentOrNull
        ?: "${event.kind} (${event.payload.size} fields)"
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = KilnSpace.padCard, vertical = KilnSpace.s7),
            verticalAlignment = Alignment.Top,
        ) {
            Text(
                text = fmtAgo(event.timestamp),
                style = type.metaMonoSmall,
                color = KilnColors.textFaint,
                modifier = Modifier.width(64.dp),
            )
            Text(
                text = text,
                style = type.smallBody,
                color = KilnColors.textBody,
                modifier = Modifier.weight(1f),
            )
        }
        if (divider) HairlineDivider(color = KilnColors.hairlineRow)
    }
}

private val prettyJson = Json { prettyPrint = true }
private fun prettyPrintJson(obj: JsonObject): String =
    prettyJson.encodeToString(JsonObject.serializer(), obj)

// ── Connection ────────────────────────────────────────────────────────────
//
// The saved API base URL and bearer token (masked by default). While
// disconnected every other screen renders a "Not connected" error, so it is
// never ambiguous whether what's on screen is real.

@Composable
private fun ConnectionCard() {
    val type = LocalKilnTypography.current
    val store = LocalConfigStore.current
    val isLive = LocalIsLive.current
    val scope = rememberCoroutineScope()
    val saved by store.flow.collectAsState(initial = null)

    var baseUrlInput by remember { mutableStateOf("") }
    var tokenInput by remember { mutableStateOf("") }
    var initialized by remember { mutableStateOf(false) }
    var revealToken by remember { mutableStateOf(false) }

    if (!initialized && saved != null) {
        baseUrlInput = saved?.baseUrl.orEmpty()
        tokenInput = saved?.bearerToken.orEmpty()
        initialized = true
    }

    Column {
        KilnBanner(
            title = if (isLive) "Connected" else "Not connected",
            description = if (isLive) {
                "Reading the live brokerage account through your API."
            } else {
                "Enter the API URL and bearer token to connect."
            },
            tone = if (isLive) Tone.Success else Tone.Neutral,
        )
        Spacer(Modifier.height(KilnSpace.gapGrid))

        KilnCard(padded = true) {
            KilnField(
                label = "Base URL",
                value = baseUrlInput,
                onValueChange = { baseUrlInput = it },
                placeholder = "https://portfolio.example.com",
                mono = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            )
            Spacer(Modifier.height(KilnSpace.s10))
            KilnField(
                label = "Bearer token",
                value = tokenInput,
                onValueChange = { tokenInput = it },
                placeholder = "API_BEARER_TOKEN from secrets.env",
                mono = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                visualTransformation = if (revealToken) {
                    VisualTransformation.None
                } else PasswordVisualTransformation(),
                trailing = {
                    val interaction = remember { MutableInteractionSource() }
                    Text(
                        text = if (revealToken) "HIDE" else "SHOW",
                        style = type.microLabel,
                        color = KilnColors.textTertiary,
                        modifier = Modifier
                            .clip(KilnRadius.inline)
                            .clickable(interactionSource = interaction, indication = null) {
                                revealToken = !revealToken
                            }
                            .padding(horizontal = KilnSpace.s3, vertical = KilnSpace.s3),
                    )
                },
            )
            Spacer(Modifier.height(KilnSpace.s11))
            Row(horizontalArrangement = Arrangement.spacedBy(KilnSpace.s7)) {
                KilnButton(
                    label = if (isLive) "Save changes" else "Connect",
                    kind = ButtonKind.Primary,
                    enabled = baseUrlInput.isNotBlank() && tokenInput.isNotBlank(),
                    onClick = { scope.launch { store.save(baseUrlInput, tokenInput) } },
                )
                if (isLive) {
                    KilnButton(
                        label = "Disconnect",
                        kind = ButtonKind.Ghost,
                        onClick = {
                            scope.launch { store.clear() }
                            baseUrlInput = ""
                            tokenInput = ""
                        },
                    )
                }
            }
        }
    }
}
