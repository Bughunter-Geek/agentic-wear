package io.github.sirbughunter.agenticwear

import android.content.Context
import android.content.ContextWrapper
import io.github.sirbughunter.agenticwear.data.AppPreferences
import io.github.sirbughunter.agenticwear.data.PayloadCodec
import io.github.sirbughunter.agenticwear.model.*
import org.json.JSONObject

/** Debug-only, isolated preference namespace. No pairing, transport or model calls. */
internal object SubmissionPersistenceQa {
    fun run(context: Context, stage: String): String {
        val isolated = object : ContextWrapper(context) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("qa_submission_store", mode)
        }
        val prefs = AppPreferences(isolated)
        val expected = SubmittedTurn("qa-request", "qa-chat", "Preserve this submitted text.", 1791576000000L, SubmissionPhase.UNCERTAIN)
        if (stage == "seed") {
            prefs.changeSubmittedTurns { listOf(expected) }
            check(AppPreferences(isolated).submittedTurns.single() == expected)
            return "SUBMISSION_SEED_PASS"
        }
        check(stage == "restore")
        check(prefs.submittedTurns.single() == expected) { "Submission did not survive process restart" }
        val wire = JSONObject("""{"version":1,"kind":"chat.snapshot","threadId":"qa-chat","title":"QA","status":"active","generatedAt":1791576001000,"messages":[{"id":"qa-native-user","turnId":"qa-turn","role":"user","kind":"message","text":"Preserve this submitted text.","watchRequestId":"qa-request"},{"id":"qa-native-answer","turnId":"qa-turn","role":"assistant","kind":"message","text":"Received.","phase":"final_answer"}]}""")
        val snapshot = checkNotNull(PayloadCodec.decodeChatSnapshot(wire))
        check(snapshot.messages.first().watchRequestId == expected.requestId)
        val restored = checkNotNull(PayloadCodec.chatSnapshotFromJson(PayloadCodec.chatSnapshotToJson(snapshot)))
        check(restored.messages == snapshot.messages)
        prefs.changeSubmittedTurns { items -> items.map { it.reconcile(restored) } }
        val done = AppPreferences(isolated).submittedTurns.single()
        check(done.phase == SubmissionPhase.COMPLETED && done.nativeMessageId == "qa-native-user")
        check(submittedChatMessages(restored, listOf(done)).size == 2)
        check(submissionStatusLabel(done, false, restored) == "Reply received")
        return "SUBMISSION_RESTORE_PASS"
    }
}
