package com.claudeportfolio.app.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.claudeportfolio.app.ui.theme.PortfolioColors

/**
 * Loading-state placeholder building blocks.
 *
 * The handoff specifies "skeleton bars (1px-radius rectangles in `Line2`).
 * No spinners." We add a very subtle alpha shimmer (0.6 → 1.0) so it's
 * obvious something is loading without being noisy.
 */

@Composable
fun SkeletonBar(
    width: Dp,
    height: Dp = 14.dp,
    modifier: Modifier = Modifier,
) {
    val transition = rememberInfiniteTransition(label = "skeleton-shimmer")
    val alpha by transition.animateFloat(
        initialValue = 0.6f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 900),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "skeleton-alpha",
    )
    Box(
        modifier = modifier
            .width(width)
            .height(height)
            .clip(RoundedCornerShape(1.dp))
            .background(PortfolioColors.Line2.copy(alpha = alpha)),
    )
}

@Composable
fun SkeletonBarFlex(
    height: Dp = 14.dp,
    modifier: Modifier = Modifier,
) {
    val transition = rememberInfiniteTransition(label = "skeleton-shimmer-flex")
    val alpha by transition.animateFloat(
        initialValue = 0.6f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 900),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "skeleton-alpha-flex",
    )
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(1.dp))
            .background(PortfolioColors.Line2.copy(alpha = alpha)),
    )
}

// ── Page-level skeletons ────────────────────────────────────────────────
//
// Each one mirrors its real screen's vertical layout so the shape doesn't
// jump when data arrives. Internal — only used inside the screens package.

@Composable
fun PortfolioSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(PortfolioColors.Bg)
            .padding(start = 22.dp, end = 22.dp, top = 8.dp, bottom = 24.dp),
    ) {
        // Equity hero
        Spacer(Modifier.height(8.dp))
        SkeletonBar(width = 56.dp, height = 11.dp) // EQUITY eyebrow
        Spacer(Modifier.height(10.dp))
        SkeletonBar(width = 220.dp, height = 38.dp) // big number
        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            SkeletonBar(width = 130.dp, height = 14.dp)
            SkeletonBar(width = 130.dp, height = 14.dp)
        }
        Spacer(Modifier.height(14.dp))
        SkeletonBar(width = 200.dp, height = 12.dp)
        Spacer(Modifier.height(28.dp))

        // Section header
        SkeletonBar(width = 180.dp, height = 11.dp)
        Spacer(Modifier.height(14.dp))

        // 5 position rows
        repeat(5) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.padding(end = 12.dp)) {
                    SkeletonBar(width = 60.dp, height = 14.dp)
                    Spacer(Modifier.height(6.dp))
                    SkeletonBar(width = 140.dp, height = 11.dp)
                }
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End) {
                    SkeletonBar(width = 70.dp, height = 14.dp)
                    Spacer(Modifier.height(6.dp))
                    SkeletonBar(width = 50.dp, height = 11.dp)
                }
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
fun LastRunSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(PortfolioColors.Bg)
            .padding(start = 22.dp, end = 22.dp, top = 8.dp, bottom = 24.dp),
    ) {
        SkeletonBar(width = 70.dp, height = 11.dp) // SUMMARY
        Spacer(Modifier.height(10.dp))
        SkeletonBarFlex(height = 14.dp)
        Spacer(Modifier.height(6.dp))
        SkeletonBarFlex(height = 14.dp)
        Spacer(Modifier.height(6.dp))
        SkeletonBar(width = 200.dp, height = 14.dp)
        Spacer(Modifier.height(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            repeat(4) { SkeletonBar(width = 50.dp, height = 28.dp) }
        }
        Spacer(Modifier.height(28.dp))

        SkeletonBar(width = 180.dp, height = 11.dp) // RECOMMENDATIONS
        Spacer(Modifier.height(14.dp))
        repeat(3) {
            Row {
                SkeletonBar(width = 36.dp, height = 14.dp)
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.fillMaxWidth()) {
                    SkeletonBar(width = 80.dp, height = 14.dp)
                    Spacer(Modifier.height(6.dp))
                    SkeletonBarFlex(height = 11.dp)
                }
            }
            Spacer(Modifier.height(22.dp))
        }
    }
}

@Composable
fun MemoSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(PortfolioColors.Bg)
            .padding(start = 22.dp, end = 22.dp, top = 8.dp, bottom = 24.dp),
    ) {
        SkeletonBarFlex(height = 13.dp)
        Spacer(Modifier.height(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            repeat(4) { SkeletonBar(width = 60.dp, height = 14.dp) }
        }
        Spacer(Modifier.height(20.dp))
        repeat(3) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                SkeletonBar(width = 60.dp, height = 14.dp)
                SkeletonBar(width = 100.dp, height = 11.dp)
            }
            Spacer(Modifier.height(8.dp))
            SkeletonBarFlex(height = 13.dp)
            Spacer(Modifier.height(6.dp))
            SkeletonBarFlex(height = 13.dp)
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
fun HistorySkeleton() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(PortfolioColors.Bg)
            .padding(start = 22.dp, end = 22.dp, top = 8.dp, bottom = 24.dp),
    ) {
        SkeletonBar(width = 240.dp, height = 13.dp)
        Spacer(Modifier.height(18.dp))
        repeat(6) {
            Row(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(end = 12.dp)) {
                    SkeletonBar(width = 160.dp, height = 14.dp)
                    Spacer(Modifier.height(6.dp))
                    SkeletonBar(width = 220.dp, height = 11.dp)
                }
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End) {
                    SkeletonBar(width = 50.dp, height = 12.dp)
                    Spacer(Modifier.height(6.dp))
                    SkeletonBar(width = 50.dp, height = 12.dp)
                }
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
fun SettingsSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(PortfolioColors.Bg)
            .padding(start = 22.dp, end = 22.dp, top = 8.dp, bottom = 24.dp),
    ) {
        SkeletonBar(width = 100.dp, height = 11.dp) // CONNECTION label
        Spacer(Modifier.height(18.dp))
        SkeletonBarFlex(height = 38.dp) // base url field
        Spacer(Modifier.height(14.dp))
        SkeletonBarFlex(height = 38.dp) // bearer field
        Spacer(Modifier.height(28.dp))
        SkeletonBar(width = 100.dp, height = 11.dp) // BOT CONTROLS label
        Spacer(Modifier.height(14.dp))
        repeat(3) {
            SkeletonBarFlex(height = 38.dp)
            Spacer(Modifier.height(10.dp))
        }
    }
}
