package com.claudeportfolio.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/**
 * Five line-style nav icons. Matches the handoff:
 *   - 22×22 viewport
 *   - 1.6px stroke
 *   - rounded line caps + joins
 *
 * Path coordinates ported (and lightly cleaned up) from the SVG specs
 * in the Claude Design handoff's `shell.jsx::NavIcon`.
 *
 * The icons are intentionally tiny pure shapes drawn on a Canvas rather
 * than vector drawables. Keeps everything in Kotlin, easier to tweak.
 */

private val ICON_SIZE = 22.dp
private const val STROKE_PX = 1.6f
private const val VIEW = 22f

@Composable
private fun strokedIcon(
    color: Color,
    modifier: Modifier = Modifier,
    pathBuilder: Path.() -> Unit,
) {
    Canvas(modifier = modifier.size(ICON_SIZE)) {
        val scale = size.minDimension / VIEW
        val path = Path().apply(pathBuilder)

        // Scale the path from the 22pt viewport to actual pixels.
        val matrix = androidx.compose.ui.graphics.Matrix().apply { scale(scale, scale) }
        path.transform(matrix)

        drawPath(
            path = path,
            color = color,
            style = Stroke(
                width = STROKE_PX * scale,
                cap = StrokeCap.Round,
                join = StrokeJoin.Round,
                pathEffect = PathEffect.cornerPathEffect(0f),
            ),
        )
    }
}

/** Bar chart — four vertical bars of varying height. */
@Composable
fun PortfolioIcon(color: Color, modifier: Modifier = Modifier) = strokedIcon(color, modifier) {
    moveTo(3f, 18f);   lineTo(3f,  12f)
    moveTo(8f, 18f);   lineTo(8f,  9f)
    moveTo(13f, 18f);  lineTo(13f, 5f)
    moveTo(18f, 18f);  lineTo(18f, 11f)
}

/** Clock — circle + hour/minute hands. */
@Composable
fun LastRunIcon(color: Color, modifier: Modifier = Modifier) = strokedIcon(color, modifier) {
    addOval(androidx.compose.ui.geometry.Rect(left = 3f, top = 3f, right = 19f, bottom = 19f))
    moveTo(11f, 7f);   lineTo(11f, 11f); lineTo(14f, 13f)
}

/** Document — page with horizontal lines. */
@Composable
fun MemoIcon(color: Color, modifier: Modifier = Modifier) = strokedIcon(color, modifier) {
    moveTo(5f, 3f);    lineTo(15f, 3f);  lineTo(18f, 6f)
    lineTo(18f, 19f);  lineTo(5f, 19f);  close()
    moveTo(8f, 9f);    lineTo(15f, 9f)
    moveTo(8f, 12f);   lineTo(15f, 12f)
    moveTo(8f, 15f);   lineTo(13f, 15f)
}

/** Circular arrow with clock face — history. */
@Composable
fun HistoryIcon(color: Color, modifier: Modifier = Modifier) = strokedIcon(color, modifier) {
    // Three-quarter circle starting at 9 o'clock and arcing clockwise.
    arcTo(
        rect = androidx.compose.ui.geometry.Rect(left = 3f, top = 3f, right = 19f, bottom = 19f),
        startAngleDegrees = 135f,
        sweepAngleDegrees = 270f,
        forceMoveTo = true,
    )
    // Arrow head pointing back to start.
    moveTo(3f, 11f);  lineTo(3f, 7f);  lineTo(7f, 7f)
    // Center dot
    moveTo(11f, 11f); lineTo(11f, 11.001f)
    // Hands
    moveTo(11f, 8f);  lineTo(11f, 11f); lineTo(13f, 13f)
}

/** Gear with center dot — settings. */
@Composable
fun SettingsIcon(color: Color, modifier: Modifier = Modifier) = strokedIcon(color, modifier) {
    addOval(androidx.compose.ui.geometry.Rect(left = 8f, top = 8f, right = 14f, bottom = 14f))
    // Eight teeth as short radial spokes
    moveTo(11f, 2.5f); lineTo(11f, 5f)
    moveTo(11f, 17f);  lineTo(11f, 19.5f)
    moveTo(2.5f, 11f); lineTo(5f, 11f)
    moveTo(17f, 11f);  lineTo(19.5f, 11f)
    moveTo(5f, 5f);    lineTo(7f, 7f)
    moveTo(15f, 15f);  lineTo(17f, 17f)
    moveTo(17f, 5f);   lineTo(15f, 7f)
    moveTo(5f, 17f);   lineTo(7f, 15f)
}
