package com.claudeportfolio.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.claudeportfolio.app.ui.theme.KilnColors
import com.claudeportfolio.app.ui.theme.KilnSpace

/**
 * Loading placeholders.
 *
 * These used to shimmer. Kiln forbids it, in as many words: "Skeleton — a
 * shape where a value would be. Never a shimmer. The slot staying empty IS
 * the message; a zero would be a lie." So the animation is gone and these are
 * flat [KilnColors.borderSubtle] shapes at Kiln's art radius.
 *
 * Each page skeleton mirrors its real screen's vertical rhythm so the layout
 * doesn't jump when data lands.
 */

@Composable
fun SkeletonBar(
    width: Dp,
    height: Dp = 14.dp,
    modifier: Modifier = Modifier,
) = KilnSkeleton(modifier = modifier, width = width, height = height)

@Composable
fun SkeletonBarFlex(
    height: Dp = 14.dp,
    modifier: Modifier = Modifier,
) = KilnSkeleton(modifier = modifier, width = null, height = height)

@Composable
private fun SkeletonPage(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(KilnColors.surfaceApp)
            .padding(
                horizontal = KilnSpace.padScreenH,
                vertical = KilnSpace.padScreenV,
            ),
        content = content,
    )
}

@Composable
fun PortfolioSkeleton() {
    SkeletonPage {
        // Equity hero: micro label, big figure, then the four stat columns.
        SkeletonBar(width = 56.dp, height = 11.dp)
        Spacer(Modifier.height(KilnSpace.s7))
        SkeletonBar(width = 200.dp, height = 34.dp)
        Spacer(Modifier.height(KilnSpace.s13))
        Row(horizontalArrangement = Arrangement.spacedBy(KilnSpace.gapGrid)) {
            repeat(4) {
                Column(modifier = Modifier.weight(1f)) {
                    SkeletonBar(width = 34.dp, height = 10.dp)
                    Spacer(Modifier.height(KilnSpace.s4))
                    SkeletonBarFlex(height = 14.dp)
                }
            }
        }
        Spacer(Modifier.height(KilnSpace.gapSection))
        SkeletonBarFlex(height = 72.dp)   // cash / buying power / cost basis card
        Spacer(Modifier.height(KilnSpace.gapSection))

        SkeletonBar(width = 170.dp, height = 11.dp)
        Spacer(Modifier.height(KilnSpace.s7))
        repeat(5) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(vertical = KilnSpace.s8),
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    SkeletonBar(width = 58.dp, height = 15.dp)
                    Spacer(Modifier.height(KilnSpace.s4))
                    SkeletonBar(width = 150.dp, height = 11.dp)
                }
                Column(horizontalAlignment = Alignment.End) {
                    SkeletonBar(width = 66.dp, height = 15.dp)
                    Spacer(Modifier.height(KilnSpace.s4))
                    SkeletonBar(width = 46.dp, height = 11.dp)
                }
            }
        }
    }
}

@Composable
fun LastRunSkeleton() {
    SkeletonPage {
        SkeletonBar(width = 70.dp, height = 11.dp)
        Spacer(Modifier.height(KilnSpace.s7))
        SkeletonBarFlex(height = 16.dp)
        Spacer(Modifier.height(KilnSpace.s4))
        SkeletonBarFlex(height = 16.dp)
        Spacer(Modifier.height(KilnSpace.s4))
        SkeletonBar(width = 210.dp, height = 16.dp)
        Spacer(Modifier.height(KilnSpace.gapSection))
        Row(horizontalArrangement = Arrangement.spacedBy(KilnSpace.gapGrid)) {
            repeat(3) { SkeletonBarFlex(height = 62.dp, modifier = Modifier.weight(1f)) }
        }
        Spacer(Modifier.height(KilnSpace.gapSection))
        SkeletonBar(width = 180.dp, height = 11.dp)
        Spacer(Modifier.height(KilnSpace.s7))
        repeat(3) {
            SkeletonBarFlex(height = 76.dp)
            Spacer(Modifier.height(KilnSpace.gapGrid))
        }
    }
}

@Composable
fun MemoSkeleton() {
    SkeletonPage {
        SkeletonBarFlex(height = 14.dp)
        Spacer(Modifier.height(KilnSpace.gapSection))
        Row(horizontalArrangement = Arrangement.spacedBy(KilnSpace.gapGrid)) {
            repeat(3) { SkeletonBarFlex(height = 62.dp, modifier = Modifier.weight(1f)) }
        }
        Spacer(Modifier.height(KilnSpace.gapSection))
        repeat(3) {
            SkeletonBarFlex(height = 96.dp)
            Spacer(Modifier.height(KilnSpace.gapGrid))
        }
    }
}

@Composable
fun HistorySkeleton() {
    SkeletonPage {
        SkeletonBar(width = 230.dp, height = 11.dp)
        Spacer(Modifier.height(KilnSpace.s7))
        repeat(6) {
            SkeletonBarFlex(height = 64.dp)
            Spacer(Modifier.height(KilnSpace.gapGrid))
        }
    }
}

@Composable
fun SettingsSkeleton() {
    SkeletonPage {
        SkeletonBar(width = 100.dp, height = 11.dp)
        Spacer(Modifier.height(KilnSpace.s7))
        SkeletonBarFlex(height = 48.dp)
        Spacer(Modifier.height(KilnSpace.gapGrid))
        SkeletonBarFlex(height = 48.dp)
        Spacer(Modifier.height(KilnSpace.gapSection))
        SkeletonBar(width = 110.dp, height = 11.dp)
        Spacer(Modifier.height(KilnSpace.s7))
        repeat(3) {
            SkeletonBarFlex(height = 56.dp)
            Spacer(Modifier.height(KilnSpace.s7))
        }
    }
}
