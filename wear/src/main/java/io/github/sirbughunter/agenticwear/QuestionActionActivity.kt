package io.github.sirbughunter.agenticwear

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import io.github.sirbughunter.agenticwear.data.AgenticWearRepository
import io.github.sirbughunter.agenticwear.model.QuestionAnswer
import io.github.sirbughunter.agenticwear.notification.AgentNotifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Target of the option actions on question notifications. Not exported: only PendingIntents created
 * by this app can start it, so no other app can make the watch answer a question.
 */
class QuestionActionActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val threadId = intent.getStringExtra(MainActivity.EXTRA_THREAD_ID)
        val itemId = intent.getStringExtra(MainActivity.EXTRA_QUESTION_ITEM_ID)
        val answer = intent.getStringExtra(MainActivity.EXTRA_QUESTION_ANSWER)?.trim()
        if (!threadId.isNullOrBlank() && !itemId.isNullOrBlank() && !answer.isNullOrEmpty()) {
            val request = QuestionAnswer(
                threadId, itemId, intent.getIntExtra(MainActivity.EXTRA_QUESTION_INDEX, 0).coerceIn(0, 9),
                intent.getStringExtra(MainActivity.EXTRA_QUESTION_TEXT).orEmpty(), answer,
            )
            intent.getStringExtra(MainActivity.EXTRA_ALERT_EVENT_ID)?.let { AgentNotifier.cancel(this, it) }
            val repository = AgenticWearRepository(applicationContext)
            // Outlives this activity; the outbox keeps the request if it is interrupted.
            sendScope.launch { runCatching { repository.submitQuestionAnswer(request) } }
            // Consumed: a replayed intent must not resend.
            intent = Intent()
        }
        if (!threadId.isNullOrBlank()) {
            startActivity(
                Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    .putExtra(MainActivity.EXTRA_THREAD_ID, threadId),
            )
        }
        finish()
    }

    private companion object {
        val sendScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}
