package com.claudeportfolio.app.ui.screens

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudeportfolio.app.data.api.PortfolioApi
import com.claudeportfolio.app.data.model.ActivityEvent
import com.claudeportfolio.app.data.model.BriefingPayload
import com.claudeportfolio.app.ui.LocalApi
import com.claudeportfolio.app.ui.LocalConfigStore
import com.claudeportfolio.app.ui.LocalIsLive
import com.claudeportfolio.app.ui.LocalRefreshTick
import com.claudeportfolio.app.ui.format.fmtAgo
import com.claudeportfolio.app.ui.theme.LocalPortfolioTypography
import com.claudeportfolio.app.ui.theme.PortfolioColors
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Settings screen.
 *
 * Three sections per the handoff:
 *   1. Bot controls — Active toggle, Live trading toggle (with confirm),
 *      Force run button.
 *   2. This week's briefing — outline button toggling a `<pre>`-style block.
 *   3. Recent activity — stack of timestamp + text rows.
 */
@Composable
fun SettingsScreen() {
    val api = LocalApi.current
    val type = LocalPortfolioTypography.current

    val activeFlag = remember { mutableStateOf(false) }
    val liveFlag   = remember { mutableStateOf(false) }
    val activity   = remember { mutableStateOf<List<ActivityEvent>>(emptyList()) }
    val briefing   = remember { mutableStateOf<BriefingPayload?>(null) }
    var briefingExpanded by remember { mutableStateOf(false) }

    var pendingLiveOn by remember { mutableStateOf(false) }
    var pendingForceRun by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()
    val tick = LocalRefreshTick.current

    LaunchedEffect(tick) {
        activeFlag.value = api.getFlagActive().value
        liveFlag.value   = api.getFlagLive().value
        activity.value   = api.getActivity(limit = 30)
        briefing.value   = api.getBriefingLatest()
    }

    val toolbarAndContent = Modifier
        .fillMaxSize()
        .background(PortfolioColors.Bg)
        .verticalScroll(rememberScrollState())
        .padding(horizontal = 22.dp)
        .padding(top = 8.dp, bottom = 24.dp)

    Column(modifier = toolbarAndContent) {
        // ── 0. Connection ──────────────────────────────────────────────
        SectionLabel("CONNECTION")
        ConnectionSection()
        Spacer(modifier = Modifier.height(24.dp))

        // ── 1. Bot controls ────────────────────────────────────────────
        SectionLabel("BOT CONTROLS")
        ToggleRow(
            title = "Active flag",
            hint = "SSM /claude-portfolio-active",
            checked = activeFlag.value,
            onChange = { newValue ->
                scope.launch {
                    activeFlag.value = api.setFlagActive(newValue).value
                }
            },
            danger = false,
        )
        ToggleRow(
            title = "Live trading",
            hint = if (liveFlag.value) "EXECUTOR_LIVE=true · paper acct"
                   else "Dry-run: orders not placed",
            checked = liveFlag.value,
            onChange = { newValue ->
                if (newValue) {
                    pendingLiveOn = true       // ask for confirmation first
                } else {
                    scope.launch {
                        liveFlag.value = api.setFlagLive(false).value
                    }
                }
            },
            danger = true,
        )
        ButtonRow(
            title = "Force run now",
            hint = "Bypasses active flag",
            buttonLabel = "Run",
            onClick = { pendingForceRun = true },
        )

        // ── 2. This week's briefing ────────────────────────────────────
        Spacer(modifier = Modifier.height(24.dp))
        SectionLabel("THIS WEEK'S BRIEFING")

        BriefingInspector(
            briefing = briefing.value,
            expanded = briefingExpanded,
            onToggle = { briefingExpanded = !briefingExpanded },
        )

        // ── 3. Recent activity ─────────────────────────────────────────
        Spacer(modifier = Modifier.height(24.dp))
        SectionLabel("RECENT ACTIVITY")
        if (activity.value.isEmpty()) {
            Text(
                "No activity yet.",
                style = type.bodySecondary,
                color = PortfolioColors.Dim,
                modifier = Modifier.padding(vertical = 14.dp),
            )
        } else {
            for (event in activity.value) {
                ActivityRow(event)
            }
        }
    }

    // ── Confirmations ────────────────────────────────────────────────
    if (pendingLiveOn) {
        AlertDialog(
            onDismissRequest = { pendingLiveOn = false },
            title = { Text("Enable live trading?") },
            text = {
                Text("Orders will be sent to your Alpaca paper account on the next run.")
            },
            confirmButton = {
                TextButton(onClick = {
                    pendingLiveOn = false
                    scope.launch {
                        liveFlag.value = api.setFlagLive(true).value
                    }
                }) { Text("Enable") }
            },
            dismissButton = {
                TextButton(onClick = { pendingLiveOn = false }) { Text("Cancel") }
            },
            containerColor = PortfolioColors.Surface,
            titleContentColor = PortfolioColors.Fg,
            textContentColor = PortfolioColors.Dim,
        )
    }
    if (pendingForceRun) {
        AlertDialog(
            onDismissRequest = { pendingForceRun = false },
            title = { Text("Run pipeline now?") },
            text = { Text("Bypasses active flag. Pipeline takes 3–8 minutes.") },
            confirmButton = {
                TextButton(onClick = {
                    pendingForceRun = false
                    scope.launch { api.runForce() }
                }) { Text("Run") }
            },
            dismissButton = {
                TextButton(onClick = { pendingForceRun = false }) { Text("Cancel") }
            },
            containerColor = PortfolioColors.Surface,
            titleContentColor = PortfolioColors.Fg,
            textContentColor = PortfolioColors.Dim,
        )
    }
}

// ── Pieces ────────────────────────────────────────────────────────────

@Composable
private fun SectionLabel(label: String) {
    val type = LocalPortfolioTypography.current
    Text(
        text = label,
        style = type.eyebrow,
        color = PortfolioColors.Dim,
        modifier = Modifier.padding(top = 4.dp, bottom = 4.dp),
    )
}

@Composable
private fun ToggleRow(
    title: String,
    hint: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    danger: Boolean,
) {
    val type = LocalPortfolioTypography.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 14.dp)
            .drawBottomLine(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = type.body, color = PortfolioColors.Fg)
            Text(
                text = hint,
                style = type.caption,
                color = PortfolioColors.Dim,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Toggle(checked = checked, danger = danger, onChange = onChange)
    }
}

@Composable
private fun Toggle(checked: Boolean, danger: Boolean, onChange: (Boolean) -> Unit) {
    val onColor = if (danger) PortfolioColors.Neg else PortfolioColors.Pos
    val track = if (checked) onColor else PortfolioColors.Line2
    val thumbOffset by animateDpAsState(if (checked) 22.dp else 2.dp, label = "toggle")
    Box(
        modifier = Modifier
            .width(44.dp)
            .height(24.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(track)
            .clickable { onChange(!checked) },
    ) {
        Box(
            modifier = Modifier
                .padding(start = thumbOffset, top = 2.dp)
                .size(20.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(PortfolioColors.Bg),
        )
    }
}

@Composable
private fun ButtonRow(
    title: String,
    hint: String,
    buttonLabel: String,
    onClick: () -> Unit,
) {
    val type = LocalPortfolioTypography.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 14.dp)
            .drawBottomLine(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = type.body, color = PortfolioColors.Fg)
            Text(
                text = hint,
                style = type.caption,
                color = PortfolioColors.Dim,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Box(
            modifier = Modifier
                .clickable(onClick = onClick)
                .clip(RoundedCornerShape(8.dp))
                .border(1.dp, PortfolioColors.Line2, RoundedCornerShape(8.dp))
                .padding(horizontal = 18.dp, vertical = 8.dp),
        ) {
            Text(buttonLabel, style = type.bodySecondary, color = PortfolioColors.Fg)
        }
    }
}

@Composable
private fun BriefingInspector(
    briefing: BriefingPayload?,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
    val type = LocalPortfolioTypography.current
    val symCount = (briefing?.briefing?.get("symbolsCovered") as? kotlinx.serialization.json.JsonArray)?.size ?: 0
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 14.dp)
            .drawBottomLine(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .clickable(onClick = onToggle)
                .clip(RoundedCornerShape(8.dp))
                .border(1.dp, PortfolioColors.Line2, RoundedCornerShape(8.dp))
                .padding(horizontal = 14.dp, vertical = 8.dp),
        ) {
            Text(
                if (expanded) "Hide briefing JSON" else "Inspect briefing JSON",
                style = type.bodySecondary,
                color = PortfolioColors.Fg,
            )
        }
        Spacer(modifier = Modifier.weight(1f))
        Text("$symCount symbols", style = type.caption, color = PortfolioColors.Dim)
    }
    if (expanded) {
        val text = briefing?.briefing?.let { prettyPrintJson(it) } ?: "—"
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 280.dp)
                .background(PortfolioColors.Surface)
                .padding(12.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                text = text,
                style = type.mono.copy(lineHeight = 18.sp),
                color = PortfolioColors.Dim,
            )
        }
    }
}

@Composable
private fun ActivityRow(event: ActivityEvent) {
    val type = LocalPortfolioTypography.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp)
            .drawBottomLine(),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = fmtAgo(event.timestamp),
            style = type.caption,
            color = PortfolioColors.Dim,
            modifier = Modifier.width(70.dp),
        )
        val text = (event.payload["text"] as? JsonPrimitive)?.contentOrNull
            ?: "${event.kind} (${event.payload.size} fields)"
        Text(
            text = text,
            style = type.caption,
            color = PortfolioColors.Fg,
            modifier = Modifier.weight(1f),
        )
    }
}

/**
 * Pretty-print a JsonObject using the kotlinx-serialization formatter so
 * the inspector's `<pre>` block renders properly indented JSON.
 */
private val prettyJson = Json { prettyPrint = true }
private fun prettyPrintJson(obj: JsonObject): String =
    prettyJson.encodeToString(JsonObject.serializer(), obj)

// ── Connection section ───────────────────────────────────────────────
//
// Shows the saved API base URL + bearer token (the token is masked) and
// lets the user edit / save / disconnect. When disconnected the rest of
// the app falls back to MockApi.

@Composable
private fun ConnectionSection() {
    val type = LocalPortfolioTypography.current
    val store = LocalConfigStore.current
    val isLive = LocalIsLive.current
    val scope = rememberCoroutineScope()
    val saved by store.flow.collectAsState(initial = null)

    var baseUrlInput by remember { mutableStateOf("") }
    var tokenInput by remember { mutableStateOf("") }
    var initialized by remember { mutableStateOf(false) }
    var revealToken by remember { mutableStateOf(false) }

    // Seed the inputs once the saved values arrive.
    if (!initialized && saved != null) {
        baseUrlInput = saved?.baseUrl.orEmpty()
        tokenInput = saved?.bearerToken.orEmpty()
        initialized = true
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
    ) {
        Text(
            text = if (isLive) "Live · talking to your API"
                   else "Mock data · enter your API URL and bearer token to connect",
            style = type.caption,
            color = if (isLive) PortfolioColors.Pos else PortfolioColors.Dim,
            modifier = Modifier.padding(bottom = 12.dp),
        )

        ConfigField(
            label = "BASE URL",
            value = baseUrlInput,
            onValueChange = { baseUrlInput = it },
            placeholder = "https://xxxxx.execute-api.us-east-1.amazonaws.com",
            keyboardType = KeyboardType.Uri,
        )
        Spacer(Modifier.height(10.dp))
        ConfigField(
            label = "BEARER TOKEN",
            value = tokenInput,
            onValueChange = { tokenInput = it },
            placeholder = "paste from Secrets Manager",
            keyboardType = KeyboardType.Password,
            visualTransformation = if (revealToken) VisualTransformation.None else PasswordVisualTransformation(),
            trailingLabel = if (revealToken) "HIDE" else "SHOW",
            onTrailingClick = { revealToken = !revealToken },
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ConnectionButton(
                label = if (isLive) "Save changes" else "Connect",
                enabled = baseUrlInput.isNotBlank() && tokenInput.isNotBlank(),
                onClick = {
                    scope.launch { store.save(baseUrlInput, tokenInput) }
                },
            )
            if (isLive) {
                ConnectionButton(
                    label = "Disconnect",
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

@Composable
private fun ConfigField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailingLabel: String? = null,
    onTrailingClick: (() -> Unit)? = null,
) {
    val type = LocalPortfolioTypography.current
    Text(label, style = type.eyebrow, color = PortfolioColors.Dim)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(PortfolioColors.Surface)
            .border(1.dp, PortfolioColors.Line2, RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.weight(1f)) {
            if (value.isEmpty()) {
                Text(placeholder, style = type.bodySecondary, color = PortfolioColors.Dim2)
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = type.bodySecondary.copy(color = PortfolioColors.Fg),
                cursorBrush = SolidColor(PortfolioColors.Fg),
                keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
                visualTransformation = visualTransformation,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (trailingLabel != null && onTrailingClick != null) {
            Text(
                text = trailingLabel,
                style = type.microLabel,
                color = PortfolioColors.Dim,
                modifier = Modifier
                    .clickable(onClick = onTrailingClick)
                    .padding(start = 10.dp, top = 2.dp, bottom = 2.dp),
            )
        }
    }
}

@Composable
private fun ConnectionButton(
    label: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val type = LocalPortfolioTypography.current
    val color = if (enabled) PortfolioColors.Fg else PortfolioColors.Dim2
    Box(
        modifier = Modifier
            .clickable(enabled = enabled, onClick = onClick)
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, if (enabled) PortfolioColors.Line2 else PortfolioColors.Line, RoundedCornerShape(8.dp))
            .padding(horizontal = 18.dp, vertical = 8.dp),
    ) {
        Text(label, style = type.bodySecondary, color = color)
    }
}
