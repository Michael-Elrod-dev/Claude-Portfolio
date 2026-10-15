package com.claudeportfolio.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import com.claudeportfolio.app.ui.theme.KilnColors
import com.claudeportfolio.app.ui.theme.KilnSpace
import com.claudeportfolio.app.ui.theme.LocalKilnTypography

/**
 * App bar, Kiln-styled.
 *
 * Kiln's web `.k-appbar` is a single 52px line with a title and an actions
 * slot. This keeps the app's two-line shape, because the eyebrow carries real
 * information on a phone (the run date, the position count) that has nowhere
 * else to go — but everything else is Kiln: the eyebrow is a mono micro label
 * (it is machine-owned text), the title is the sans page-title role, the
 * status is a [KilnPill] with a glowing dot, and the bar sits flush on
 * [KilnColors.surfaceApp] with a structural hairline beneath instead of a
 * shadow.
 */
@Composable
fun PortfolioAppBar(
    eyebrow: String,
    title: String,
    statusLabel: String = "Live",
    statusOk: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val type = LocalKilnTypography.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(KilnColors.surfaceApp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    start = KilnSpace.padScreenH,
                    end = KilnSpace.padScreenH,
                    top = KilnSpace.s10,
                    bottom = KilnSpace.s7,
                ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                if (eyebrow.isNotBlank()) {
                    SectionLabel(eyebrow)
                }
                Text(
                    text = title,
                    style = type.pageTitle,
                    color = KilnColors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = KilnSpace.s2),
                )
            }
            KilnPill(
                label = statusLabel,
                tone = if (statusOk) Tone.Quiet else Tone.Danger,
                dot = if (statusOk) DotState.Live else DotState.Dead,
                modifier = Modifier.padding(start = KilnSpace.s8),
            )
        }
        HairlineDivider(color = KilnColors.hairlineStructural)
    }
}
