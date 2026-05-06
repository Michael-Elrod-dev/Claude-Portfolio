package com.claudeportfolio.app.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.GoogleFont
import androidx.compose.ui.text.googlefonts.Font as GoogleFontFont
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.claudeportfolio.app.R

/**
 * Inter (UI) + JetBrains Mono (mono blocks) loaded as Downloadable Fonts via
 * Google Fonts. The provider needs the cert array stored in
 * res/values/font_certs.xml and a privacy-acceptable provider package
 * (Google Play Services). For sideloaded apps that's already on every
 * supported device; we still need the cert array so the loader can verify.
 *
 * If Google Play services aren't available (unlikely on a personal device)
 * the fallback chain is sans-serif → monospace, which still renders.
 */
private val googleFontProvider = GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs
)

private val Inter = FontFamily(
    GoogleFontFont(GoogleFont("Inter"), googleFontProvider, FontWeight.Normal),
    GoogleFontFont(GoogleFont("Inter"), googleFontProvider, FontWeight.Medium),
    GoogleFontFont(GoogleFont("Inter"), googleFontProvider, FontWeight.SemiBold),
    GoogleFontFont(GoogleFont("Inter"), googleFontProvider, FontWeight.Bold),
)

private val JetBrainsMono = FontFamily(
    GoogleFontFont(GoogleFont("JetBrains Mono"), googleFontProvider, FontWeight.Normal),
    GoogleFontFont(GoogleFont("JetBrains Mono"), googleFontProvider, FontWeight.Medium),
)

/**
 * Type scale matching the handoff's table:
 *
 * | Role                 | Size | Weight | Letter-spacing |
 * |----------------------|-----:|-------:|---------------:|
 * | Equity hero number   |   40 |    500 |             -1 |
 * | Screen title         |   22 |    500 |           -0.3 |
 * | Section ticker       |   15 |    600 |           -0.2 |
 * | Body                 |   14 |    400 |              0 |
 * | Body-secondary       |   13 |    400 |              0 |
 * | Caption              |   12 |    400 |              0 |
 * | Label / eyebrow      |   11 |  400/600 |          0.4 (UPPERCASE) |
 * | Micro-label          |   10 |    500 |   0.5 (UPPERCASE) |
 *
 * Numeric styles enable tabular-num via `FeatureSettings("tnum")` in
 * [PlatformTextStyle]. The 'tnum' feature is a CSS-style font-feature flag
 * that asks the font for fixed-width digits. Inter and JetBrains Mono both
 * support it.
 */
data class PortfolioTypography(
    val equityHero: TextStyle,
    val screenTitle: TextStyle,
    val sectionTicker: TextStyle,
    val body: TextStyle,
    val bodySecondary: TextStyle,
    val caption: TextStyle,
    val eyebrow: TextStyle,
    val microLabel: TextStyle,
    val mono: TextStyle,
)

private val tnumFeature = "tnum"

private fun ui(
    size: Int,
    weight: FontWeight,
    letterSpacing: Double = 0.0,
    italic: Boolean = false,
    tabularNums: Boolean = false,
) = TextStyle(
    fontFamily = Inter,
    fontSize = size.sp,
    fontWeight = weight,
    letterSpacing = letterSpacing.em,
    fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal,
    fontFeatureSettings = if (tabularNums) tnumFeature else null,
)

val PortfolioTypographyDefault = PortfolioTypography(
    // -1 in CSS letter-spacing on a 40px font is roughly -0.025 em.
    equityHero    = ui(40, FontWeight.Medium,   letterSpacing = -0.025, tabularNums = true),
    screenTitle   = ui(22, FontWeight.Medium,   letterSpacing = -0.014),
    sectionTicker = ui(15, FontWeight.SemiBold, letterSpacing = -0.013),
    body          = ui(14, FontWeight.Normal),
    bodySecondary = ui(13, FontWeight.Normal),
    caption       = ui(12, FontWeight.Normal,                                 tabularNums = true),
    eyebrow       = ui(11, FontWeight.Normal,   letterSpacing = 0.036),
    microLabel    = ui(10, FontWeight.Medium,   letterSpacing = 0.05),
    mono          = TextStyle(
        fontFamily = JetBrainsMono,
        fontSize = 12.sp,
        fontWeight = FontWeight.Normal,
        fontFeatureSettings = tnumFeature,
    ),
)

val LocalPortfolioTypography = staticCompositionLocalOf { PortfolioTypographyDefault }

@Composable
fun ProvidePortfolioTypography(
    typography: PortfolioTypography = PortfolioTypographyDefault,
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalPortfolioTypography provides typography, content = content)
}
