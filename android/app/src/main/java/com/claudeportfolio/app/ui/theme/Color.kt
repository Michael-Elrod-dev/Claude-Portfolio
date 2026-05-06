package com.claudeportfolio.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Design tokens — exact hex values from the original Claude Design
 * handoff. The app is dark-only by design; there is no light variant.
 * Don't rename these — the spec references them by name (Bg, Fg, Dim,
 * Pos, Neg, Amber, Line, Line2, etc.).
 */
object PortfolioColors {
    val Bg       = Color(0xFF0D0D0E)
    val Surface  = Color(0xFF141416)
    val Surface2 = Color(0xFF1A1A1D)
    val Fg       = Color(0xFFECECEE)
    val Dim      = Color(0xFF8A8A92)
    val Dim2     = Color(0xFF5B5B62)
    val Line     = Color(0xFF1F1F23)
    val Line2    = Color(0xFF26262B)
    val Pos      = Color(0xFF5FB98A)   // P/L positive, "executed", success toggle
    val Neg      = Color(0xFFE07B6B)   // P/L negative, "failed", danger toggle
    val Amber    = Color(0xFFE6C267)   // "queued_for_review"
}
