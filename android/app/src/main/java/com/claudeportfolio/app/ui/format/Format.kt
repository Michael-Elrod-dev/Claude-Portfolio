package com.claudeportfolio.app.ui.format

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.abs

/**
 * Formatters mirroring the JS `fmt` helpers from the Claude Design
 * handoff. Same signatures, same outputs.
 *
 * Localization is intentionally pinned to en-US to match the design's
 * thousand-separator and abbreviation conventions exactly.
 */

private val LOC = Locale.US

/**
 * USD formatter.
 *  - sign=true emits "+" for positive values; default off (so $-style
 *    standalone numbers don't get a leading +).
 *  - compact=true switches to "$1.5k" form for values >= 1000.
 *  - decimals controls trailing precision (default 2).
 */
fun fmtUsd(
    n: Double?,
    sign: Boolean = false,
    compact: Boolean = false,
    decimals: Int = 2,
): String {
    if (n == null) return "—"
    val abs = abs(n)
    val s = when {
        n < 0 -> "-"
        sign && n > 0 -> "+"
        else -> ""
    }
    if (compact && abs >= 1000.0) {
        return "%s$%.1fk".format(LOC, s, abs / 1000.0)
    }
    val pattern = "%,.${decimals}f"
    return "%s$%s".format(LOC, s, pattern.format(LOC, abs))
}

/** Percent with a leading sign by default; pass sign=false to suppress. */
fun fmtPct(n: Double?, sign: Boolean = true, decimals: Int = 2): String {
    if (n == null) return "—"
    val v = n * 100.0
    val s = when {
        v < 0 -> "-"
        sign && v > 0 -> "+"
        else -> ""
    }
    return "%s%.${decimals}f%%".format(LOC, s, abs(v))
}

/** "1,234" — used for share counts and similar. */
fun fmtNum(n: Double?, decimals: Int = 0): String {
    if (n == null) return "—"
    val pattern = "%,.${decimals}f"
    return pattern.format(LOC, n)
}

/** "May 3" */
fun fmtDateShort(iso: String?): String {
    if (iso == null) return ""
    return runCatching {
        val d = parseDate(iso)
        d.format(DateTimeFormatter.ofPattern("MMM d", LOC))
    }.getOrDefault(iso)
}

/** "Sun, May 3, 2026" */
fun fmtDateLong(iso: String?): String {
    if (iso == null) return ""
    return runCatching {
        val d = parseDate(iso)
        val dow = d.dayOfWeek.getDisplayName(TextStyle.SHORT, LOC)
        "$dow, ${d.format(DateTimeFormatter.ofPattern("MMM d, yyyy", LOC))}"
    }.getOrDefault(iso)
}

/** "MAY 3" — uppercase form used in app-bar eyebrow. */
fun fmtDateEyebrow(iso: String?): String = fmtDateShort(iso).uppercase(LOC)

/** Day-of-week + date eyebrow: "SUN · MAY 3, 2026". */
fun fmtDayDateEyebrow(iso: String?): String {
    if (iso == null) return ""
    return runCatching {
        val d = parseDate(iso)
        val dow = d.dayOfWeek.getDisplayName(TextStyle.SHORT, LOC).uppercase(LOC)
        val rest = d.format(DateTimeFormatter.ofPattern("MMM d, yyyy", LOC)).uppercase(LOC)
        "$dow · $rest"
    }.getOrDefault(iso.uppercase(LOC))
}

/** Relative timestamp: "3m ago", "2h ago", "4d ago". */
fun fmtAgo(iso: String?, now: Instant = Instant.now()): String {
    if (iso == null) return ""
    val then = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
    val diffSec = (now.toEpochMilli() - then.toEpochMilli()) / 1000
    return when {
        diffSec < 60   -> "just now"
        diffSec < 3600 -> "${diffSec / 60}m ago"
        diffSec < 86400 -> "${diffSec / 3600}h ago"
        else           -> "${diffSec / 86400}d ago"
    }
}

private fun parseDate(iso: String): LocalDate {
    // Accept either "YYYY-MM-DD" (no timezone — already a calendar
    // date) or a full ISO instant (UTC) which we project to the
    // device's local timezone before extracting the date. Without
    // systemDefault here, e.g. a 9pm EST timestamp would render as
    // "tomorrow" because UTC is already past midnight.
    return if (iso.length == 10 && iso[4] == '-') {
        LocalDate.parse(iso)
    } else {
        Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate()
    }
}
