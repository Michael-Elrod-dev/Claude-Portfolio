package com.claudeportfolio.app.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Text
import com.claudeportfolio.app.ui.theme.LocalPortfolioTypography
import com.claudeportfolio.app.ui.theme.PortfolioColors

/**
 * Two-line app bar matching the handoff spec.
 *
 *  Padding: 14 22 10 (top, sides, bottom).
 *  Top line:    UPPERCASE eyebrow in Dim, 11sp, letter-spacing 0.4em-ish.
 *  Bottom line: 22sp / weight 500 / letter-spacing -0.3, [PortfolioColors.Fg].
 *  Right pill:  6dp Pos dot + label in 11sp Dim, 1px Line2 border, radius 999.
 *
 * No surface fill — sits flush on the page background. There is intentionally
 * no Material `TopAppBar` chrome (no back arrow, no overflow menu) per the
 * handoff direction.
 */
@Composable
fun PortfolioAppBar(
    eyebrow: String,
    title: String,
    statusLabel: String = "Active · dry-run",
    statusOk: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val type = LocalPortfolioTypography.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 22.dp, end = 22.dp, top = 14.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column {
            Text(
                text = eyebrow.uppercase(),
                style = type.eyebrow,
                color = PortfolioColors.Dim,
            )
            Text(
                text = title,
                style = type.screenTitle,
                color = PortfolioColors.Fg,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        StatusPill(label = statusLabel, ok = statusOk)
    }
}

@Composable
private fun StatusPill(label: String, ok: Boolean) {
    val type = LocalPortfolioTypography.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .border(width = 1.dp, color = PortfolioColors.Line2, shape = RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Box(
            modifier = Modifier
                .size(6.dp)
                .clip(CircleShape)
                .background(if (ok) PortfolioColors.Pos else PortfolioColors.Neg),
        )
        Text(
            text = label,
            style = type.eyebrow.copy(textAlign = TextAlign.Start),
            color = PortfolioColors.Dim,
            modifier = Modifier.padding(start = 6.dp),
        )
    }
}
