package com.claudeportfolio.app.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.GoogleFont
import androidx.compose.ui.text.googlefonts.Font as GoogleFontFont
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.claudeportfolio.app.R

/**
 * Kiln type, ported from the design system's `tokens/typography.css`.
 *
 * Two families and a strict division of labour, which is the single most
 * characteristic thing about Kiln:
 *
 *   Instrument Sans — anything a PERSON wrote: titles, prose, theses, button
 *                     labels, the analyst's summary.
 *   JetBrains Mono  — anything the MACHINE owns: numbers, tickers, timestamps,
 *                     IDs, status words, micro labels, the big equity figure.
 *
 * If a dollar amount renders in sans, that is a bug. The mono roles below are
 * marked; use them rather than assembling size + weight per call site.
 *
 * ── Sizes are mobile-adapted, on purpose ────────────────────────────────────
 * Kiln's own values are a desktop tool's (body 13.5px, nano 9.5px, and its
 * spacing file says so outright: "a desktop-tool language: rows are 13-16px
 * tall in padding"). On a phone that body size sits under Android's
 * comfortable range and the nano labels stop being legible, so the ramp is
 * scaled by roughly 1.15x: body lands on 16sp, the figure on 34sp, and
 * nothing falls below 10.5sp. Everything else about Kiln — the palette, the
 * family split, the tracking, the radius scale, hairline-not-shadow depth —
 * is ported unchanged.
 *
 * Tracking is in `em`, which is scale-invariant, so those values ARE Kiln's
 * verbatim.
 */
private val googleFontProvider = GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs
)

/** Kiln's sans. Replaces Inter, which the pre-Kiln theme used. */
private val InstrumentSans = FontFamily(
    GoogleFontFont(GoogleFont("Instrument Sans"), googleFontProvider, FontWeight.Normal),
    GoogleFontFont(GoogleFont("Instrument Sans"), googleFontProvider, FontWeight.Medium),
    GoogleFontFont(GoogleFont("Instrument Sans"), googleFontProvider, FontWeight.SemiBold),
)

private val JetBrainsMono = FontFamily(
    GoogleFontFont(GoogleFont("JetBrains Mono"), googleFontProvider, FontWeight.Normal),
    GoogleFontFont(GoogleFont("JetBrains Mono"), googleFontProvider, FontWeight.Medium),
    GoogleFontFont(GoogleFont("JetBrains Mono"), googleFontProvider, FontWeight.SemiBold),
)

// ── the size ramp, mobile-adapted from Kiln's ───────────────────────────────
private val SizeFigure = 34.sp      // kiln 30
private val SizePageTitle = 25.sp   // kiln 22
private val SizeHeadline = 22.sp    // kiln 19
private val SizeDialogTitle = 19.sp // kiln 17
private val SizeLead = 20.sp        // kiln 18
private val SizeIdentity = 17.sp    // kiln 15
private val SizeBody = 16.sp        // kiln 13.5
private val SizeBase = 15.sp        // kiln 13
private val SizeCompact = 14.sp     // kiln 12.5
private val SizeSmall = 13.5.sp     // kiln 12
private val SizeMeta = 12.5.sp      // kiln 11
private val SizeMicro = 11.5.sp     // kiln 10
private val SizeNano = 11.sp        // kiln 9.5

// ── tracking, verbatim from Kiln (em is scale-invariant) ────────────────────
private const val TrackTight = -0.02
private const val TrackTitle = -0.01
private const val TrackHeadline = -0.015
private const val TrackPill = 0.06
private const val TrackWordmark = 0.08
private const val TrackMicro = 0.1

/** Fixed-width digits. Both families support it; numbers must not jitter. */
private const val TNUM = "tnum"

/**
 * Kiln's thirteen text roles. Mono roles are called out because the family
 * split is a rule, not a preference.
 */
data class KilnTypography(
    /** mono — the one big number on a screen */
    val figure: TextStyle,
    val pageTitle: TextStyle,
    val headline: TextStyle,
    val dialogTitle: TextStyle,
    val lead: TextStyle,
    val identity: TextStyle,
    val cardTitle: TextStyle,
    val rowTitle: TextStyle,
    val body: TextStyle,
    val cell: TextStyle,
    val button: TextStyle,
    /** mono — uppercase micro labels above values */
    val microLabel: TextStyle,
    /** mono — status words in pills */
    val status: TextStyle,
    /** mono — the smallest outcome chips */
    val outcome: TextStyle,
    /** mono — timestamps, IDs, counts */
    val metaMono: TextStyle,
    /** mono — the app wordmark */
    val wordmark: TextStyle,
)

private fun sans(
    size: androidx.compose.ui.unit.TextUnit,
    weight: FontWeight,
    tracking: Double = 0.0,
    lineHeight: Double? = null,
) = TextStyle(
    fontFamily = InstrumentSans,
    fontSize = size,
    fontWeight = weight,
    letterSpacing = tracking.em,
    lineHeight = if (lineHeight != null) (size.value * lineHeight).sp else androidx.compose.ui.unit.TextUnit.Unspecified,
)

private fun mono(
    size: androidx.compose.ui.unit.TextUnit,
    weight: FontWeight,
    tracking: Double = 0.0,
) = TextStyle(
    fontFamily = JetBrainsMono,
    fontSize = size,
    fontWeight = weight,
    letterSpacing = tracking.em,
    fontFeatureSettings = TNUM,
)

val KilnTypographyDefault = KilnTypography(
    figure = mono(SizeFigure, FontWeight.SemiBold, TrackTight),
    pageTitle = sans(SizePageTitle, FontWeight.SemiBold, TrackTitle),
    headline = sans(SizeHeadline, FontWeight.SemiBold, TrackHeadline, lineHeight = 1.3),
    dialogTitle = sans(SizeDialogTitle, FontWeight.SemiBold, lineHeight = 1.25),
    lead = sans(SizeLead, FontWeight.Normal, lineHeight = 1.5),
    identity = sans(SizeIdentity, FontWeight.Medium),
    cardTitle = sans(SizeBase, FontWeight.SemiBold),
    rowTitle = sans(SizeBody, FontWeight.SemiBold),
    body = sans(SizeBody, FontWeight.Normal, lineHeight = 1.6),
    cell = sans(SizeBase, FontWeight.Normal, lineHeight = 1.4),
    button = sans(SizeCompact, FontWeight.SemiBold),
    microLabel = mono(SizeMicro, FontWeight.Medium, TrackMicro),
    status = mono(SizeMeta, FontWeight.SemiBold, TrackPill),
    outcome = mono(SizeNano, FontWeight.SemiBold, TrackWordmark),
    metaMono = mono(SizeMeta, FontWeight.Normal),
    wordmark = mono(SizeMeta, FontWeight.Medium, TrackWordmark),
)

/**
 * Extra roles the portfolio app needs that Kiln's web vocabulary didn't have
 * a name for. Derived from existing roles rather than invented sizes.
 */
val KilnTypography.smallBody: TextStyle get() = cell.copy(fontSize = SizeSmall)
val KilnTypography.metaMonoSmall: TextStyle get() = metaMono.copy(fontSize = SizeMicro)

val LocalKilnTypography = staticCompositionLocalOf { KilnTypographyDefault }

@Composable
fun ProvideKilnTypography(
    typography: KilnTypography = KilnTypographyDefault,
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalKilnTypography provides typography, content = content)
}
