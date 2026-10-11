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
import io.github.sirbughunter.agenticwear.QuestionActionActivity
import io.github.sirbughunter.agenticwear.R
import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.questionActionRequestCode
import java.text.DateFormat
import java.util.Date

object AgentNotifier {
    private const val CHANNEL_COMPLETE = "agent_complete_v2"
    private const val CHANNEL_PERMISSION = "agent_permission_v2"
    private const val CHANNEL_ERROR = "agent_error_v2"
    private val LEGACY_CHANNELS = listOf("agent_complete_v1", "agent_permission_v1", "agent_error_v1")

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
                vibrationPattern = alertVibrationPattern()
                setSound(null, attributes)
            },
            NotificationChannel(
                CHANNEL_PERMISSION,
                context.getString(R.string.notification_channel_permission),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "One alert when an agent needs a decision"
                enableVibration(true)
                vibrationPattern = alertVibrationPattern()
                setSound(null, attributes)
            },
            NotificationChannel(
                CHANNEL_ERROR,
                context.getString(R.string.notification_channel_error),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "One alert for failed or interrupted agent turns"
                enableVibration(true)
                vibrationPattern = alertVibrationPattern()
                setSound(null, attributes)
            },
        )
        manager.createNotificationChannels(channels)
        LEGACY_CHANNELS.forEach(manager::deleteNotificationChannel)
    }

    fun post(context: Context, alert: AgentAlert) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return

        val intent = Intent(context, MainActivity::class.java).apply {
            putExtra(MainActivity.EXTRA_ALERT_EVENT_ID, alert.eventId)
            if (alert.threadId.isNotBlank()) {
                putExtra(MainActivity.EXTRA_THREAD_ID, alert.threadId)
            }
        }
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
            // Same channel (and so the same buzz) as finished replies.
            AlertKind.QUESTION -> NotificationStyle(
                CHANNEL_COMPLETE,
                "Question · $time",
                Color.rgb(124, 175, 255),
                NotificationCompat.CATEGORY_MESSAGE,
            )
        }
        val texts = notificationTexts(alert.kind, summary, alert.detail)
        val openActionIntent = PendingIntent.getActivity(
            context,
            openActionRequestCode(alert.eventId),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle(alert.title)
            .setContentText(markdownToSpannable(texts.contentText))
            .setSubText(texts.subText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(markdownToSpannable(texts.bigText)))
            .setWhen(alert.occurredAtMillis)
            .setShowWhen(true)
            .setColor(color)
            .setColorized(true)
            .setCategory(category)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setOnlyAlertOnce(true)
        if (alert.kind == AlertKind.QUESTION) {
            questionNotificationActions(alert.options).forEach { action ->
                // Answers go to a non-exported activity so no other app can send text as the user.
                val target = if (action.answer != null) QuestionActionActivity::class.java else MainActivity::class.java
                val actionIntent = Intent(context, target).apply {
                    putExtra(MainActivity.EXTRA_ALERT_EVENT_ID, alert.eventId)
                    putExtra(MainActivity.EXTRA_THREAD_ID, alert.threadId)
                    alert.questionItemId?.let { putExtra(MainActivity.EXTRA_QUESTION_ITEM_ID, it) }
                    putExtra(MainActivity.EXTRA_QUESTION_INDEX, alert.questionIndex)
                    putExtra(MainActivity.EXTRA_QUESTION_TEXT, alert.detail.take(1_000))
                    if (action.answer != null) putExtra(MainActivity.EXTRA_QUESTION_ANSWER, action.answer)
                    else if (alert.options.isEmpty()) putExtra(MainActivity.EXTRA_QUESTION_REPLY, true)
                }
                // Background apps have no network: the action opens the app, which sends the answer.
                val actionPending = PendingIntent.getActivity(
                    context,
                    questionActionRequestCode(alert.eventId, action.slot),
                    actionIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                builder.addAction(R.drawable.ic_stat_agent, action.label, actionPending)
            }
        } else if (notificationHasOpenAction(alert.kind)) {
            builder.addAction(R.drawable.ic_stat_agent, "Open", openActionIntent)
        }
        val notification = builder.build()
        NotificationManagerCompat.from(context).notify(alert.eventId.hashCode(), notification)
    }

    fun cancel(context: Context, eventId: String) {
        runCatching { NotificationManagerCompat.from(context).cancel(eventId.hashCode()) }
    }

    private data class NotificationStyle(
        val channel: String,
        val summary: String,
        val color: Int,
        val category: String,
    )
}
