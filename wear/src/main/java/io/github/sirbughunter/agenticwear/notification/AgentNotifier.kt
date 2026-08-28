package io.github.sirbughunter.agenticwear.notification

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioAttributes
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.sirbughunter.agenticwear.MainActivity
import io.github.sirbughunter.agenticwear.R
import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AlertKind
import java.text.DateFormat
import java.util.Date

object AgentNotifier {
    private const val CHANNEL_COMPLETE = "agent_complete_v1"
    private const val CHANNEL_PERMISSION = "agent_permission_v1"
    private const val CHANNEL_ERROR = "agent_error_v1"

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .build()
        val channels = listOf(
            NotificationChannel(
                CHANNEL_COMPLETE,
                context.getString(R.string.notification_channel_complete),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "One alert when an agent finishes a full turn"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 1_000)
                setSound(null, attributes)
            },
            NotificationChannel(
                CHANNEL_PERMISSION,
                context.getString(R.string.notification_channel_permission),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Distinct alerts when an agent needs a decision"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 280, 120, 280, 120, 650)
                setSound(null, attributes)
            },
            NotificationChannel(
                CHANNEL_ERROR,
                context.getString(R.string.notification_channel_error),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Urgent alerts for failed or interrupted agent turns"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 850, 160, 850)
                setSound(null, attributes)
            },
        )
        manager.createNotificationChannels(channels)
    }

    fun post(context: Context, alert: AgentAlert) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return

        val intent = Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_ALERT_EVENT_ID, alert.eventId)
        val pendingIntent = PendingIntent.getActivity(
            context,
            alert.eventId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val time = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(alert.occurredAtMillis))
        val (channel, summary, color, category) = when (alert.kind) {
            AlertKind.COMPLETE -> NotificationStyle(
                CHANNEL_COMPLETE,
                "Finished at $time",
                Color.rgb(95, 232, 174),
                NotificationCompat.CATEGORY_STATUS,
            )
            AlertKind.PERMISSION -> NotificationStyle(
                CHANNEL_PERMISSION,
                "Needs permission · $time",
                Color.rgb(255, 190, 92),
                NotificationCompat.CATEGORY_CALL,
            )
            AlertKind.ERROR -> NotificationStyle(
                CHANNEL_ERROR,
                "Stopped with an error · $time",
                Color.rgb(255, 103, 126),
                NotificationCompat.CATEGORY_ERROR,
            )
        }
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle(alert.title)
            .setContentText(summary)
            .setSubText(alert.detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$summary\n${alert.detail}"))
            .setWhen(alert.occurredAtMillis)
            .setShowWhen(true)
            .setColor(color)
            .setColorized(true)
            .setCategory(category)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setOnlyAlertOnce(false)
            .build()
        NotificationManagerCompat.from(context).notify(alert.eventId.hashCode(), notification)
    }

    private data class NotificationStyle(
        val channel: String,
        val summary: String,
        val color: Int,
        val category: String,
    )
}
