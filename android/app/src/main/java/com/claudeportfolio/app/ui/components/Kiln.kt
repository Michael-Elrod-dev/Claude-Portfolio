package com.claudeportfolio.app.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Canvas
import com.claudeportfolio.app.ui.theme.KilnColors
import com.claudeportfolio.app.ui.theme.KilnMotion
import com.claudeportfolio.app.ui.theme.KilnRadius
import com.claudeportfolio.app.ui.theme.KilnSpace
import com.claudeportfolio.app.ui.theme.LocalKilnTypography
import com.claudeportfolio.app.ui.theme.metaMonoSmall
import com.claudeportfolio.app.ui.theme.smallBody

/**
 * Kiln's component vocabulary, ported to Compose.
 *
 * Every screen is assembled from these rather than from raw Boxes, so the
 * density, hairlines and type roles stay consistent. Three rules the ports
 * enforce, because they're the ones most easily lost in translation:
 *
 *   1. NO SHADOWS. Depth is a surface step plus a hairline. Kiln's elevation
 *      file is explicit that a black blur on a near-black ground is
 *      invisible, so shadow systems in dark themes degenerate into fake
 *      light borders — Kiln draws the border directly. Nothing here takes an
 *      elevation parameter.
 *   2. NO SHIMMER on skeletons. "A shape where a value would be. Never a
 *      shimmer. The slot staying empty IS the message; a zero would be a
 *      lie." The pre-Kiln theme animated these; [KilnSkeleton] does not.
 *   3. Pills are for STATE, never for content. [KilnPill] and [KilnChip]
 *      report status; anything holding data uses [KilnCard]'s 10dp radius.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────────────────

enum class CardAccent { None, Accent, Danger, Inset }

@Composable
fun KilnCard(
    modifier: Modifier = Modifier,
    accent: CardAccent = CardAccent.None,
    padded: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val border = when (accent) {
        CardAccent.Accent -> KilnColors.accentBorder
        CardAccent.Danger -> KilnColors.dangerBorder
        else -> KilnColors.hairline
    }
    val fill = if (accent == CardAccent.Inset) KilnColors.surfaceInset else KilnColors.surfaceCard
    Column(
        modifier = modifier
            .clip(KilnRadius.card)
            .background(fill)
            .border(KilnSpace.hairline, border, KilnRadius.card)
            .then(if (padded) Modifier.padding(KilnSpace.padCard) else Modifier),
        content = content,
    )
}

/** Card header: title on the left, mono meta on the right, hairline beneath. */
@Composable
fun KilnCardHeader(
    title: String,
    meta: String? = null,
    modifier: Modifier = Modifier,
) {
    val type = LocalKilnTypography.current
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = KilnSpace.padCardHeaderH, vertical = KilnSpace.padCardHeaderV),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = title,
                style = type.cardTitle,
                color = KilnColors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (meta != null) {
                Text(
                    text = meta,
                    style = type.metaMono,
                    color = KilnColors.textTertiary,
                    modifier = Modifier.padding(start = KilnSpace.s7),
                )
            }
        }
        HairlineDivider()
    }
}

@Composable
fun HairlineDivider(
    modifier: Modifier = Modifier,
    color: Color = KilnColors.hairline,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(KilnSpace.hairline)
            .background(color),
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The uppercase mono micro label that sits above a value or names a region.
 * Kiln uses these heavily; they are machine-owned text, so they are mono.
 */
@Composable
fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = KilnColors.textTertiary,
) {
    val type = LocalKilnTypography.current
    Text(
        text = text.uppercase(),
        style = type.microLabel,
        color = color,
        modifier = modifier,
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pill / Chip — state, never content
// ─────────────────────────────────────────────────────────────────────────────

enum class Tone { Accent, Success, Warning, Danger, Info, Neutral, Quiet }

private fun toneFill(tone: Tone): Color = when (tone) {
    Tone.Accent -> KilnColors.accentTint
    Tone.Success -> KilnColors.successTint
    Tone.Warning -> KilnColors.warningTint
    Tone.Danger -> KilnColors.dangerTint
    Tone.Info -> KilnColors.infoTint
    Tone.Neutral -> KilnColors.hairlineStructural
    Tone.Quiet -> Color.Transparent
}

private fun toneText(tone: Tone): Color = when (tone) {
    Tone.Accent -> KilnColors.accentHover
    Tone.Success -> KilnColors.successText
    Tone.Warning -> KilnColors.warningText
    Tone.Danger -> KilnColors.dangerText
    Tone.Info -> KilnColors.infoText
    Tone.Neutral -> KilnColors.textSecondary
    Tone.Quiet -> KilnColors.textSecondary
}

/** Rounded-full status pill: a dot plus a mono status word. */
@Composable
fun KilnPill(
    label: String,
    tone: Tone = Tone.Quiet,
    dot: DotState? = null,
    modifier: Modifier = Modifier,
) {
    val type = LocalKilnTypography.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .clip(KilnRadius.pill)
            .background(toneFill(tone))
            .then(
                if (tone == Tone.Quiet) {
                    Modifier.border(KilnSpace.hairline, KilnColors.borderMuted, KilnRadius.pill)
                } else Modifier
            )
            .padding(horizontal = KilnSpace.padPillH, vertical = KilnSpace.padPillV),
    ) {
        if (dot != null) {
            KilnDot(state = dot)
            Spacer(Modifier.width(KilnSpace.s5))
        }
        Text(text = label, style = type.status, color = toneText(tone))
    }
}

/** The smallest outcome marker — a 5dp-radius tag, not a pill. */
@Composable
fun KilnChip(
    label: String,
    tone: Tone = Tone.Neutral,
    modifier: Modifier = Modifier,
) {
    val type = LocalKilnTypography.current
    Text(
        text = label.uppercase(),
        style = type.outcome,
        color = toneText(tone),
        modifier = modifier
            .clip(KilnRadius.inline)
            .background(if (tone == Tone.Accent) KilnColors.accentTintStrong else toneFill(tone))
            .padding(horizontal = KilnSpace.s4, vertical = KilnSpace.s2),
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Dot — the one place Kiln allows a shadow, because a glow is signal not depth
// ─────────────────────────────────────────────────────────────────────────────

enum class DotState { Live, Healthy, Idle, Dead, Warning, Danger, Info }

/**
 * Status dot. Live and Healthy pulse a colored halo; Idle is the same dot at
 * reduced opacity with no animation, so it reads as "on but not busy" rather
 * than "off" — Kiln is explicit that reduced motion must not become reduced
 * information.
 */
@Composable
fun KilnDot(
    state: DotState,
    size: Dp = 7.dp,
    modifier: Modifier = Modifier,
) {
    val color = when (state) {
        DotState.Live -> KilnColors.accent
        DotState.Healthy, DotState.Idle -> KilnColors.success
        DotState.Dead -> KilnColors.textDisabled
        DotState.Warning -> KilnColors.warning
        DotState.Danger -> KilnColors.danger
        DotState.Info -> KilnColors.info
    }
    val pulses = state == DotState.Live || state == DotState.Healthy
    val durationMs = if (state == DotState.Live) {
        KilnMotion.glowDurationLiveMs
    } else {
        KilnMotion.glowDurationOkMs
    }

    val glowAlpha = if (pulses) {
        val transition = rememberInfiniteTransition(label = "kiln-dot-glow")
        val a by transition.animateFloat(
            initialValue = 0.5f,
            targetValue = 0.12f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = durationMs / 2),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "kiln-dot-glow-alpha",
        )
        a
    } else 0f

    val dotAlpha = if (state == DotState.Idle) KilnMotion.dotIdleAlpha else 1f
    val halo = size * 2.6f

    Box(
        modifier = modifier.size(halo),
        contentAlignment = Alignment.Center,
    ) {
        if (glowAlpha > 0f) {
            Canvas(modifier = Modifier.size(halo)) {
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(color.copy(alpha = glowAlpha), Color.Transparent),
                        center = Offset(this.size.width / 2f, this.size.height / 2f),
                        radius = this.size.minDimension / 2f,
                    ),
                    radius = this.size.minDimension / 2f,
                )
            }
        }
        Box(
            modifier = Modifier
                .size(size)
                .clip(CircleShape)
                .background(color.copy(alpha = dotAlpha)),
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Button
// ─────────────────────────────────────────────────────────────────────────────

enum class ButtonKind { Primary, Ghost, Text, AccentText, Danger }

@Composable
fun KilnButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: ButtonKind = ButtonKind.Ghost,
    small: Boolean = false,
    enabled: Boolean = true,
) {
    val type = LocalKilnTypography.current
    val interaction = remember { MutableInteractionSource() }

    val fill = when (kind) {
        ButtonKind.Primary -> KilnColors.accent
        ButtonKind.Danger -> KilnColors.dangerTint
        else -> Color.Transparent
    }
    val fg = when (kind) {
        ButtonKind.Primary -> KilnColors.onAccent
        ButtonKind.Ghost -> KilnColors.textBody
        ButtonKind.Text -> KilnColors.textSecondary
        ButtonKind.AccentText -> KilnColors.accentHover
        ButtonKind.Danger -> KilnColors.dangerText
    }
    val borderColor = when (kind) {
        ButtonKind.Ghost -> KilnColors.borderStrong
        ButtonKind.Danger -> KilnColors.dangerBorder
        else -> Color.Transparent
    }
    val hPad = if (small) KilnSpace.padButtonSmallH else KilnSpace.padButtonH
    val vPad = if (small) KilnSpace.padButtonSmallV else KilnSpace.padButtonV

    Box(
        modifier = modifier
            .clip(KilnRadius.control)
            .background(if (enabled) fill else fill.copy(alpha = 0.5f))
            .border(KilnSpace.hairline, borderColor, KilnRadius.control)
            // Kiln's button padding is 9x14, which on a phone is under the
            // touch-target floor, so the box is grown to meet it without
            // changing the visual padding.
            .heightIn(min = KilnSpace.hitMobile)
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = enabled,
                onClick = onClick,
            )
            .padding(horizontal = hPad, vertical = vPad),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = type.button,
            color = if (enabled) fg else fg.copy(alpha = 0.5f),
            textAlign = TextAlign.Center,
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rows
// ─────────────────────────────────────────────────────────────────────────────

/** Tappable list row: title, optional sub, trailing slot, chevron, hairline. */
@Composable
fun KilnListRow(
    title: String,
    modifier: Modifier = Modifier,
    sub: String? = null,
    onClick: (() -> Unit)? = null,
    showChevron: Boolean = onClick != null,
    divider: Boolean = true,
    trailing: (@Composable () -> Unit)? = null,
) {
    val type = LocalKilnTypography.current
    val interaction = remember { MutableInteractionSource() }
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = KilnSpace.hitMobile)
                .then(
                    if (onClick != null) {
                        Modifier.clickable(
                            interactionSource = interaction,
                            indication = null,
                            onClick = onClick,
                        )
                    } else Modifier
                )
                .padding(horizontal = KilnSpace.padRowH, vertical = KilnSpace.s8),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = type.rowTitle,
                    color = KilnColors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (sub != null) {
                    Text(
                        text = sub,
                        style = type.smallBody,
                        color = KilnColors.textTertiary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = KilnSpace.s1),
                    )
                }
            }
            if (trailing != null) {
                Spacer(Modifier.width(KilnSpace.s8))
                trailing()
            }
            if (showChevron) {
                Spacer(Modifier.width(KilnSpace.s4))
                Chevron()
            }
        }
        if (divider) HairlineDivider(color = KilnColors.hairlineRow)
    }
}

/** Label-and-value row, for a card full of readings. */
@Composable
fun KilnStatusRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color = KilnColors.textPrimary,
    divider: Boolean = true,
    leading: (@Composable () -> Unit)? = null,
) {
    val type = LocalKilnTypography.current
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 46.dp)
                .padding(horizontal = KilnSpace.padCard, vertical = KilnSpace.s8),
        ) {
            if (leading != null) {
                leading()
                Spacer(Modifier.width(KilnSpace.s7))
            }
            SectionLabel(text = label, modifier = Modifier.weight(1f))
            Text(text = value, style = type.cardTitle, color = valueColor)
        }
        if (divider) HairlineDivider(color = KilnColors.hairlineRow)
    }
}

@Composable
private fun Chevron(
    color: Color = KilnColors.textFaint,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier.size(16.dp)) {
        val w = size.width
        val h = size.height
        val stroke = Stroke(width = 1.5.dp.toPx(), cap = StrokeCap.Round)
        drawLine(
            color = color,
            start = Offset(w * 0.38f, h * 0.28f),
            end = Offset(w * 0.64f, h * 0.5f),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round,
        )
        drawLine(
            color = color,
            start = Offset(w * 0.64f, h * 0.5f),
            end = Offset(w * 0.38f, h * 0.72f),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round,
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat tiles and the one big number
// ─────────────────────────────────────────────────────────────────────────────

/** Micro label over a value. The grid unit of a dashboard. */
@Composable
fun KilnStatTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color = KilnColors.textPrimary,
    sub: String? = null,
) {
    val type = LocalKilnTypography.current
    Column(
        modifier = modifier
            .clip(KilnRadius.card)
            .background(KilnColors.surfaceCard)
            .border(KilnSpace.hairline, KilnColors.hairline, KilnRadius.card)
            .padding(horizontal = KilnSpace.s11, vertical = KilnSpace.s10),
    ) {
        SectionLabel(label)
        Spacer(Modifier.height(KilnSpace.s4))
        Text(text = value, style = type.cardTitle, color = valueColor)
        if (sub != null) {
            Spacer(Modifier.height(KilnSpace.s1))
            Text(text = sub, style = type.metaMonoSmall, color = KilnColors.textFaint)
        }
    }
}

/**
 * A bare stat column with no card around it — for the hero row, where four
 * of these sit under the big figure and card borders would be noise.
 */
@Composable
fun KilnStatColumn(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color = KilnColors.textPrimary,
) {
    val type = LocalKilnTypography.current
    Column(modifier = modifier) {
        SectionLabel(label)
        Spacer(Modifier.height(KilnSpace.s4))
        Text(
            text = value,
            style = type.metaMono.copy(fontSize = type.cardTitle.fontSize),
            color = valueColor,
            maxLines = 1,
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Banner / EmptyState / Skeleton
// ─────────────────────────────────────────────────────────────────────────────

@Composable
fun KilnBanner(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    tone: Tone = Tone.Neutral,
) {
    val type = LocalKilnTypography.current
    val border = when (tone) {
        Tone.Accent -> KilnColors.accentBorder
        Tone.Success -> KilnColors.successBorder
        Tone.Warning -> KilnColors.warningBorder
        Tone.Danger -> KilnColors.dangerBorder
        Tone.Info -> KilnColors.infoBorder
        else -> KilnColors.borderMuted
    }
    val fill = if (tone == Tone.Neutral || tone == Tone.Quiet) {
        KilnColors.surfaceCard
    } else toneFill(tone)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(KilnRadius.card)
            .background(fill)
            .border(KilnSpace.hairline, border, KilnRadius.card)
            .padding(horizontal = KilnSpace.padCard, vertical = KilnSpace.s11),
    ) {
        Text(text = title, style = type.rowTitle, color = KilnColors.textPrimary)
        if (description != null) {
            Spacer(Modifier.height(KilnSpace.s2))
            Text(text = description, style = type.smallBody, color = KilnColors.textSecondary)
        }
    }
}

/** A dashed glyph box and a sentence. Never an illustration. */
@Composable
fun KilnEmptyState(
    headline: String,
    modifier: Modifier = Modifier,
    copy: String? = null,
) {
    val type = LocalKilnTypography.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = KilnSpace.s18, horizontal = KilnSpace.s14),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(KilnRadius.card)
                .border(KilnSpace.hairline, KilnColors.borderDashed, KilnRadius.card),
        )
        Spacer(Modifier.height(KilnSpace.s8))
        Text(
            text = headline,
            style = type.headline,
            color = KilnColors.textPrimary,
            textAlign = TextAlign.Center,
        )
        if (copy != null) {
            Spacer(Modifier.height(KilnSpace.s4))
            Text(
                text = copy,
                style = type.smallBody,
                color = KilnColors.textSecondary,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * A shape where a value would be. Deliberately static — see rule 2 at the top
 * of this file.
 */
@Composable
fun KilnSkeleton(
    modifier: Modifier = Modifier,
    width: Dp? = null,
    height: Dp = 14.dp,
) {
    Box(
        modifier = modifier
            .then(if (width != null) Modifier.width(width) else Modifier.fillMaxWidth())
            .height(height)
            .clip(KilnRadius.art)
            .background(KilnColors.borderSubtle),
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kiln's switch. Off is a warm grey track; on is clay. The knob is the warm
 * off-white, never pure white.
 */
@Composable
fun KilnSwitch(
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val interaction = remember { MutableInteractionSource() }
    val trackW = 40.dp
    val trackH = 24.dp
    val knob = 18.dp
    val track = when {
        !enabled -> KilnColors.controlInertTrack
        checked -> KilnColors.accent
        else -> KilnColors.controlOffTrack
    }
    val knobColor = when {
        !enabled -> KilnColors.controlInertKnob
        checked -> KilnColors.onAccent
        else -> KilnColors.controlOffKnob
    }
    Box(
        modifier = modifier
            .size(width = trackW, height = KilnSpace.hitMobile)
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = enabled,
                onClick = { onChange(!checked) },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .size(width = trackW, height = trackH)
                .clip(KilnRadius.pill)
                .background(track),
            contentAlignment = if (checked) Alignment.CenterEnd else Alignment.CenterStart,
        ) {
            Box(
                modifier = Modifier
                    .padding(horizontal = 3.dp)
                    .size(knob)
                    .clip(CircleShape)
                    .background(knobColor),
            )
        }
    }
}

/**
 * Kiln's text field: inset surface, hairline border, mono option for anything
 * machine-owned (URLs, tokens).
 */
@Composable
fun KilnField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    mono: Boolean = false,
    singleLine: Boolean = true,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    trailing: (@Composable () -> Unit)? = null,
) {
    val type = LocalKilnTypography.current
    val textStyle: TextStyle = if (mono) {
        type.metaMono.copy(color = KilnColors.textPrimary, fontSize = type.cell.fontSize)
    } else {
        type.cell.copy(color = KilnColors.textPrimary)
    }
    Column(modifier = modifier.fillMaxWidth()) {
        if (label != null) {
            SectionLabel(label)
            Spacer(Modifier.height(KilnSpace.s5))
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(KilnRadius.chip)
                .background(KilnColors.surfaceInset)
                .border(KilnSpace.hairline, KilnColors.hairline, KilnRadius.chip)
                .defaultMinSize(minHeight = KilnSpace.hitMobile)
                .padding(horizontal = KilnSpace.padFieldH, vertical = KilnSpace.padFieldV),
            contentAlignment = Alignment.CenterStart,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty() && placeholder != null) {
                        Text(
                            text = placeholder,
                            style = textStyle,
                            color = KilnColors.textFaint,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    BasicTextField(
                        value = value,
                        onValueChange = onValueChange,
                        textStyle = textStyle,
                        singleLine = singleLine,
                        cursorBrush = SolidColor(KilnColors.accent),
                        visualTransformation = visualTransformation,
                        keyboardOptions = keyboardOptions,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (trailing != null) {
                    Spacer(Modifier.width(KilnSpace.s7))
                    trailing()
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Standard screen padding. Content lines up with card interiors. */
fun Modifier.kilnScreenPadding(): Modifier =
    this.padding(horizontal = KilnSpace.padScreenH)

@Composable
fun SectionHeader(
    label: String,
    modifier: Modifier = Modifier,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(bottom = KilnSpace.s7),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SectionLabel(label, modifier = Modifier.weight(1f))
        trailing?.invoke(this)
    }
}
