package com.claudeportfolio.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/**
 * Kiln spacing and radius, ported from `tokens/spacing.css` and
 * `tokens/radius.css`.
 *
 * The scale is NOT a 4px grid: 2/3/4/6/7/9/10/12/13/14/16/18/20/24/26/28. The
 * odd numbers are deliberate — the source design's paddings are 13x18 rows and
 * 9x14 buttons, and rounding them to 12x16 changes the density of every
 * screen. They are ported verbatim.
 *
 * What is NOT ported verbatim: Kiln's desktop chrome widths (--w-rail: 64px,
 * --w-min: 900px, --bp-stack: 1100px) are meaningless on a phone and omitted.
 * Interactive rows are floored at [hitMobile] rather than Kiln's 13x18 desktop
 * row padding, which would land under Android's touch-target guidance.
 */
object KilnSpace {
    val s1 = 2.dp
    val s2 = 3.dp
    val s3 = 4.dp
    val s4 = 6.dp
    val s5 = 7.dp
    val s6 = 9.dp
    val s7 = 10.dp
    val s8 = 12.dp
    val s9 = 13.dp
    val s10 = 14.dp
    val s11 = 16.dp
    val s12 = 18.dp
    val s13 = 20.dp
    val s14 = 24.dp
    val s15 = 26.dp
    val s16 = 28.dp
    val s17 = 34.dp
    val s18 = 40.dp
    val s19 = 52.dp

    // ── gaps, named by what they separate ────────────────────────────────────
    val gapChip = 6.dp
    val gapGrid = 12.dp
    val gapRegion = 16.dp
    val gapSection = 20.dp

    // ── component padding ───────────────────────────────────────────────────
    val padCard = 18.dp
    val padCardHeaderH = 18.dp
    val padCardHeaderV = 13.dp
    val padRowH = 18.dp
    val padRowV = 13.dp
    val padSettingRowV = 16.dp
    val padButtonH = 14.dp
    val padButtonV = 9.dp
    val padButtonSmallH = 12.dp
    val padButtonSmallV = 7.dp
    val padFieldH = 12.dp
    val padFieldV = 9.dp
    val padPillH = 11.dp
    val padPillV = 5.dp
    val padChipH = 13.dp
    val padChipV = 6.dp
    val padDialog = 26.dp

    /**
     * Screen gutter. Kiln's --pad-page is 26x28 for a desktop window; on a
     * phone the horizontal half is the one that matters and 18dp matches the
     * card padding so content lines up with card interiors.
     */
    val padScreenH = 18.dp
    val padScreenV = 20.dp

    // ── hit targets ─────────────────────────────────────────────────────────
    /** Kiln's own mobile hit target. Anything tappable gets at least this. */
    val hitMobile = 48.dp
    val hitStepper = 28.dp

    /** Hairline width. One device pixel would vanish; Kiln draws 1px. */
    val hairline = 1.dp
}

/**
 * Kiln radius: softened, never rounded. The largest radius on a rectangle is
 * 14dp on a dialog; everything else sits between 3 and 12. Pills are reserved
 * for things that report a STATE — never things that hold content.
 */
object KilnRadius {
    val tile = RoundedCornerShape(3.dp)
    val inline = RoundedCornerShape(5.dp)
    val art = RoundedCornerShape(6.dp)
    val tooltip = RoundedCornerShape(7.dp)
    val chip = RoundedCornerShape(8.dp)
    val control = RoundedCornerShape(9.dp)
    val card = RoundedCornerShape(10.dp)
    val avatarLg = RoundedCornerShape(12.dp)
    val dialog = RoundedCornerShape(14.dp)
    val sheet = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 0.dp, bottomStart = 0.dp)
    val pill = RoundedCornerShape(999.dp)
}

/**
 * Motion, from `tokens/motion.css`: almost none.
 *
 * Kiln has exactly two looping keyframes, both glows on status dots, and one
 * transition duration for control state changes. There are no page
 * transitions, no entrance animations, no bounces, no springs — "a tool that
 * animates its own chrome is a tool getting in the way." Resist adding any.
 */
object KilnMotion {
    const val durationControlMs = 120
    const val durationFadeMs = 160
    const val glowDurationLiveMs = 2600
    const val glowDurationOkMs = 3400

    /** Offline is the same dot at reduced opacity: on, but not busy. */
    const val dotIdleAlpha = 0.55f
}
