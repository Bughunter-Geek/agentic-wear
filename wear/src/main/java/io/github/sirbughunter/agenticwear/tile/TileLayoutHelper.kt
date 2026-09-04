package io.github.sirbughunter.agenticwear.tile

import android.content.Context
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DeviceParametersBuilders.DeviceParameters
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.material.Chip
import androidx.wear.protolayout.material.ChipColors
import androidx.wear.protolayout.material.CompactChip
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.protolayout.material.layouts.PrimaryLayout
import io.github.sirbughunter.agenticwear.MainActivity
import io.github.sirbughunter.agenticwear.model.AgentSession
import io.github.sirbughunter.agenticwear.model.SessionStatus

internal const val TILE_RESOURCES_VERSION = "1"

// Theme color constants matching Agentic Wear dark palette
internal const val COLOR_INK = 0xFF090A0F.toInt()
internal const val COLOR_PANEL_RAISED = 0xFF1A1D27.toInt()
internal const val COLOR_CYAN = 0xFF4DEEEA.toInt()
internal const val COLOR_VIOLET = 0xFF9B51E0.toInt()
internal const val COLOR_FROST = 0xFFE0E6ED.toInt()
internal const val COLOR_CORAL = 0xFFFF5A78.toInt()
internal const val COLOR_MINT = 0xFF64E6AE.toInt()
internal const val COLOR_MUTED = 0xFF7A8394.toInt()

object TileLayoutHelper {

    fun maxVisibleSessions(screenHeightDp: Int, fontScale: Float): Int =
        if (screenHeightDp < 200 || fontScale > 1.15f) 1 else 2

    fun sessionTitle(session: AgentSession): String =
        session.title.trim().ifEmpty { "Codex session" }

    fun contentDescription(session: AgentSession): String {
        val (statusText, _) = statusDisplay(session)
        return "${sessionTitle(session)}, $statusText"
    }

    fun buildLayout(
        context: Context,
        deviceParameters: DeviceParameters,
        sessions: List<AgentSession>,
    ): LayoutElementBuilders.LayoutElement {
        val primaryLayout = PrimaryLayout.Builder(deviceParameters)
            .setResponsiveContentInsetEnabled(true)
            .setPrimaryLabelTextContent(
                Text.Builder(context, "Recent sessions")
                    .setTypography(Typography.TYPOGRAPHY_CAPTION1)
                    .setColor(argb(COLOR_CYAN))
                    .build(),
            )

        if (sessions.isEmpty()) {
            primaryLayout.setContent(
                LayoutElementBuilders.Column.Builder()
                    .setWidth(expand())
                    .addContent(
                        Text.Builder(context, "No recent sessions")
                            .setTypography(Typography.TYPOGRAPHY_BODY1)
                            .setColor(argb(COLOR_FROST))
                            .build(),
                    )
                    .addContent(
                        LayoutElementBuilders.Spacer.Builder().setHeight(dp(4f)).build(),
                    )
                    .addContent(
                        Text.Builder(context, "Start Codex to begin")
                            .setTypography(Typography.TYPOGRAPHY_CAPTION2)
                            .setColor(argb(COLOR_MUTED))
                            .build(),
                    )
                    .build(),
            )
            primaryLayout.setPrimaryChipContent(
                CompactChip.Builder(
                    context,
                    "Open app",
                    openAppClickable(context, "open_app_empty"),
                    deviceParameters,
                )
                    .setChipColors(
                        ChipColors(
                            COLOR_PANEL_RAISED,
                            COLOR_CYAN,
                        ),
                    )
                    .build(),
            )
        } else {
            val maxSessions = maxVisibleSessions(deviceParameters.screenHeightDp, deviceParameters.fontScale)
            val displaySessions = sessions.take(maxSessions)
            val contentColumn = LayoutElementBuilders.Column.Builder()
                .setWidth(expand())

            displaySessions.forEachIndexed { index, session ->
                if (index > 0) {
                    contentColumn.addContent(
                        LayoutElementBuilders.Spacer.Builder().setHeight(dp(4f)).build(),
                    )
                }
                contentColumn.addContent(
                    buildSessionChip(context, session, deviceParameters),
                )
            }

            primaryLayout.setContent(contentColumn.build())
            primaryLayout.setPrimaryChipContent(
                CompactChip.Builder(
                    context,
                    if (sessions.size > maxSessions) "All sessions" else "Open app",
                    openAppClickable(context, "open_app_recent"),
                    deviceParameters,
                )
                    .setChipColors(
                        ChipColors(
                            COLOR_PANEL_RAISED,
                            COLOR_CYAN,
                        ),
                    )
                    .build(),
            )
        }

        return primaryLayout.build()
    }

    fun buildSessionChip(
        context: Context,
        session: AgentSession,
        deviceParameters: DeviceParameters,
    ): LayoutElementBuilders.LayoutElement {
        val (statusText, statusColor) = statusDisplay(session)
        val clickable = sessionClickable(context, session.id)
        val title = sessionTitle(session)

        return Chip.Builder(context, clickable, deviceParameters)
            .setWidth(expand())
            .setPrimaryLabelContent(title)
            .setSecondaryLabelContent(statusText)
            .setContentDescription(contentDescription(session))
            .setChipColors(
                ChipColors(
                    COLOR_PANEL_RAISED,
                    COLOR_FROST,
                    statusColor,
                    COLOR_CYAN,
                ),
            )
            .build()
    }

    internal fun statusDisplay(session: AgentSession): Pair<String, Int> = when (session.status) {
        SessionStatus.ACTIVE -> "Working" to COLOR_CYAN
        SessionStatus.IDLE -> "Ready" to COLOR_MINT
        SessionStatus.ERROR -> "Needs attention" to COLOR_CORAL
        SessionStatus.NOT_LOADED -> "Available" to COLOR_MINT
    }

    internal fun openAppClickable(context: Context, id: String): ModifiersBuilders.Clickable {
        val launchAction = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(context.packageName)
                    .setClassName(MainActivity::class.java.name)
                    .build(),
            )
            .build()
        return ModifiersBuilders.Clickable.Builder()
            .setId(id)
            .setOnClick(launchAction)
            .build()
    }

    internal fun sessionClickable(context: Context, threadId: String): ModifiersBuilders.Clickable {
        val launchAction = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(context.packageName)
                    .setClassName(MainActivity::class.java.name)
                    .addKeyToExtraMapping(
                        MainActivity.EXTRA_THREAD_ID,
                        ActionBuilders.stringExtra(threadId),
                    )
                    .build(),
            )
            .build()
        return ModifiersBuilders.Clickable.Builder()
            .setId("session_$threadId")
            .setOnClick(launchAction)
            .build()
    }
}
