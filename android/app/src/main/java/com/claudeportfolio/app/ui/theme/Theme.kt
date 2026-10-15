package com.claudeportfolio.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

/**
 * Wraps [MaterialTheme] with Kiln's dark scheme, then layers Kiln typography
 * on top via [ProvideKilnTypography].
 *
 * Most of the app reads [LocalKilnTypography] and [KilnColors] directly,
 * because Kiln's sixteen text roles and four surface steps don't map onto
 * Material 3's slots without losing the distinctions that matter (the
 * sans/mono split above all). The Material scheme below exists so that any
 * stray Material component — a dialog, a snackbar, a ripple — lands on the
 * right surface instead of Material's default purple.
 *
 * Dark only. There is no light scheme and no `isSystemInDarkTheme()` branch:
 * Kiln has one palette by design.
 *
 * Note on elevation: Kiln has NO drop shadows. Depth is a surface step plus a
 * hairline, because a black blur on a near-black ground is invisible and
 * shadow systems in dark themes degenerate into fake light borders anyway.
 * Kiln draws the border directly. So: never pass `elevation` or `shadow` to a
 * Kiln surface — use [KilnColors.surfaceCard] with a [KilnColors.hairline]
 * border instead. The only shadows in the system are the colored glows on
 * status dots, which are signal rather than depth.
 */
@Composable
fun ClaudePortfolioTheme(content: @Composable () -> Unit) {
    val colorScheme = darkColorScheme(
        primary = KilnColors.accent,
        onPrimary = KilnColors.onAccent,
        primaryContainer = KilnColors.accentTint,
        onPrimaryContainer = KilnColors.accentHover,

        secondary = KilnColors.textBody,
        onSecondary = KilnColors.surfaceApp,

        background = KilnColors.surfaceApp,
        onBackground = KilnColors.textPrimary,

        surface = KilnColors.surfaceCard,
        onSurface = KilnColors.textPrimary,
        surfaceVariant = KilnColors.surfaceInset,
        onSurfaceVariant = KilnColors.textSecondary,
        surfaceContainerHighest = KilnColors.surfaceRaised,

        outline = KilnColors.borderStrong,
        outlineVariant = KilnColors.hairline,

        error = KilnColors.danger,
        onError = KilnColors.onDanger,
        errorContainer = KilnColors.dangerTint,
        onErrorContainer = KilnColors.dangerText,

        scrim = KilnColors.surfaceScrim,
    )
    MaterialTheme(colorScheme = colorScheme) {
        ProvideKilnTypography(content = content)
    }
}
