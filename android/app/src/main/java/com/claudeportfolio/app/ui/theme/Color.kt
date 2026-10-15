package com.claudeportfolio.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Kiln color, ported from the design system's `tokens/colors.css`.
 *
 * Dark only. There is no light palette, deliberately: a second palette is a
 * second thing to keep in step. Every surface is a warm near-black; the only
 * saturated color in a resting interface is clay, and it is always doing work.
 *
 * Base values first, semantic aliases second. Screens and components reference
 * the SEMANTIC names ([surfaceCard], [textSecondary], [accent], ...). A raw
 * [Ink] or hex literal at a call site is a bug — it is how a palette drifts.
 *
 * Two rules worth repeating because they are easy to undo by accident:
 *   - Text is never pure white. Warm off-white on warm near-black; #fff reads
 *     as a blue cast against this ground.
 *   - Borders are warm white at very low alpha, never a grey hex. They lighten
 *     with whatever surface sits underneath instead of fighting it.
 */
object KilnColors {

    // ── base: warm near-black ramp ───────────────────────────────────────────
    val Ink900 = Color(0xFF121110)
    val Ink850 = Color(0xFF141312)
    val Ink800 = Color(0xFF171614)
    val Ink750 = Color(0xFF1E1C1A)
    val Ink700 = Color(0xFF2A2724)
    val Ink650 = Color(0xFF332F2B)
    val Ink600 = Color(0xFF3D3934)
    val Ink550 = Color(0xFF413C37)
    val Ink500 = Color(0xFF4F4A44)
    val Ink450 = Color(0xFF514C46)
    val Ink400 = Color(0xFF57524B)
    val Ink350 = Color(0xFF6B645C)
    val Ink300 = Color(0xFF9C948A)
    val Ink200 = Color(0xFFC8C1B7)
    val Ink100 = Color(0xFFECE7DF)
    val Ink000 = Color(0xFFF0EBE1)

    // ── base: clay, the brand hue ────────────────────────────────────────────
    val Clay600 = Color(0xFFA8532F)
    val Clay500 = Color(0xFFC8663F)
    val Clay400 = Color(0xFFE0805A)
    val Clay300 = Color(0xFFEB9D7E)

    // ── base: status hues (Claude Design System, dark mode) ──────────────────
    // `solid` is the role's fill, `text` its dark-mode text colour. These
    // replaced Kiln's original sage/amber/rust, which read washed out beside
    // clay.
    val Green500 = Color(0xFF009300)
    val Green400 = Color(0xFF0CA30C)
    val Yellow500 = Color(0xFFFAB219)
    val Yellow400 = Color(0xFFDB9300)
    val Red500 = Color(0xFFD03B3B)
    val Red400 = Color(0xFFEC7E7E)

    // ── base: steel, the one cool hue ────────────────────────────────────────
    val Steel500 = Color(0xFF6F8EA9)
    val Steel400 = Color(0xFF92B0C9)

    /** The warm white every hairline and interaction wash is mixed from. */
    private val Warm = Ink000

    // ── surfaces ─────────────────────────────────────────────────────────────
    // Four steps and no more. Depth here is a surface step plus a hairline,
    // never a shadow (see [elevation] note on Theme.kt).
    val surfaceApp = Ink800
    val surfaceChrome = Ink900
    val surfaceRail = Ink850
    val surfaceCard = Ink750
    val surfaceInset = Ink850
    val surfaceRaised = Ink700
    val surfaceScrim = Color(0xFF0C0B0A).copy(alpha = 0.62f)

    // ── borders ──────────────────────────────────────────────────────────────
    val hairline = Warm.copy(alpha = 0.06f)
    val hairlineStructural = Warm.copy(alpha = 0.07f)
    val hairlineRow = Warm.copy(alpha = 0.04f)
    val borderSubtle = Warm.copy(alpha = 0.08f)
    val borderMuted = Warm.copy(alpha = 0.09f)
    val borderStrong = Warm.copy(alpha = 0.10f)
    val borderDashed = Warm.copy(alpha = 0.14f)

    // ── text ─────────────────────────────────────────────────────────────────
    // Six steps down from a warm off-white. Never #fff.
    val textPrimary = Ink100
    val textBody = Ink200
    val textSecondary = Ink300
    val textTertiary = Ink350
    val textFaint = Ink400
    val textFaintest = Ink450
    val textDisabled = Ink550
    val textLink = Clay400

    // ── accent (clay) ────────────────────────────────────────────────────────
    // The only saturated color a resting screen shows. Reserved for the primary
    // action, the live state, and the one thing on a screen that wants a look.
    val accent = Clay500
    val accentHover = Clay400
    val accentPress = Clay600
    val accentTint = Clay500.copy(alpha = 0.13f)
    val accentTintStrong = Clay500.copy(alpha = 0.14f)
    val accentWash = Clay500.copy(alpha = 0.05f)
    val accentBorder = Clay500.copy(alpha = 0.35f)

    /**
     * Text and icons sitting ON clay. Near-black, not white: clay is light
     * enough that white type on it fails contrast.
     */
    val onAccent = Color(0xFF1A1512)

    // ── semantic: success ────────────────────────────────────────────────────
    val success = Green500
    val successText = Green400
    val successTint = Green500.copy(alpha = 0.13f)
    val successTintStrong = Green500.copy(alpha = 0.14f)
    val successBorder = Green500.copy(alpha = 0.35f)
    val onSuccess = Color(0xFF121510)

    // ── semantic: warning ────────────────────────────────────────────────────
    // Distinct from danger so a screen can say "check this" without saying
    // "this failed".
    val warning = Yellow500
    val warningText = Yellow400
    val warningTint = Yellow500.copy(alpha = 0.13f)
    val warningBorder = Yellow500.copy(alpha = 0.35f)
    val onWarning = Color(0xFF191308)

    // ── semantic: danger ─────────────────────────────────────────────────────
    // A true red, a clear step away from clay so the two never read as the
    // same signal.
    val danger = Red500
    val dangerText = Red400
    val dangerTint = Red500.copy(alpha = 0.13f)
    val dangerBorder = Red500.copy(alpha = 0.35f)
    val onDanger = Ink000

    // ── semantic: info ───────────────────────────────────────────────────────
    // The one cool hue, muted hard so it sits in a warm palette without going
    // corporate-blue. Use sparingly.
    val info = Steel500
    val infoText = Steel400
    val infoTint = Steel500.copy(alpha = 0.13f)
    val infoBorder = Steel500.copy(alpha = 0.35f)

    // ── controls ─────────────────────────────────────────────────────────────
    val controlOffTrack = Ink650
    val controlOffKnob = Ink500
    val controlInertTrack = Ink700
    val controlInertKnob = Ink600
    val iconDisabled = Ink500

    // ── interaction washes ───────────────────────────────────────────────────
    // Hover/press is a warm white wash, never a lighter grey and never opacity
    // on the element itself.
    val washHover = Warm.copy(alpha = 0.025f)
    val washHoverStrong = Warm.copy(alpha = 0.05f)
    val washSelected = Warm.copy(alpha = 0.07f)
    val washPress = Warm.copy(alpha = 0.09f)

    // ── tooltip ──────────────────────────────────────────────────────────────
    val tooltipSurface = Ink700
    val tooltipBorder = Warm.copy(alpha = 0.09f)
}

/**
 * Money and P/L coloring, kept in one place so no screen decides for itself.
 *
 * Gains are the status green and losses the status red — NOT clay. Clay means
 * "this is the live thing / the primary action"; letting it also mean "down"
 * would make two unrelated signals share a colour.
 */
fun plColor(value: Double?): Color = when {
    value == null -> KilnColors.textFaint
    value > 0 -> KilnColors.successText
    value < 0 -> KilnColors.dangerText
    else -> KilnColors.textSecondary
}
