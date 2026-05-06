package com.claudeportfolio.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

/**
 * Wraps [MaterialTheme] with the dark color scheme that matches the
 * design tokens, then layers our own typography object on top via
 * [ProvidePortfolioTypography].
 *
 * Most of the app uses [LocalPortfolioTypography] directly because the
 * handoff's type roles don't map cleanly to Material 3's slots. The
 * Material typography is left at default so any stray Material component
 * (snackbar, dialog) renders sensibly.
 */
@Composable
fun ClaudePortfolioTheme(content: @Composable () -> Unit) {
    val colorScheme = darkColorScheme(
        primary = PortfolioColors.Fg,
        onPrimary = PortfolioColors.Bg,
        secondary = PortfolioColors.Pos,
        onSecondary = PortfolioColors.Bg,
        background = PortfolioColors.Bg,
        onBackground = PortfolioColors.Fg,
        surface = PortfolioColors.Surface,
        onSurface = PortfolioColors.Fg,
        surfaceVariant = PortfolioColors.Surface2,
        onSurfaceVariant = PortfolioColors.Dim,
        outline = PortfolioColors.Line2,
        error = PortfolioColors.Neg,
        onError = PortfolioColors.Bg,
    )
    MaterialTheme(colorScheme = colorScheme) {
        ProvidePortfolioTypography(content = content)
    }
}
