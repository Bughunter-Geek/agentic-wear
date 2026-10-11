package io.github.sirbughunter.agenticwear.voice

import io.github.sirbughunter.agenticwear.model.ChatPhase
import io.github.sirbughunter.agenticwear.model.ChatRole
import io.github.sirbughunter.agenticwear.model.ChatSnapshot
import io.github.sirbughunter.agenticwear.model.SubmissionPhase
import io.github.sirbughunter.agenticwear.model.SubmittedTurn

/** Turn-based voice conversation for Dot and cloud chats, which have no live call. */
enum class VoiceLoopPhase { IDLE, LISTENING, SENDING, WAITING, SPEAKING }

sealed interface VoiceLoopEvent {
    data object Start : VoiceLoopEvent
    data class Heard(val text: String) : VoiceLoopEvent
    data object Submitted : VoiceLoopEvent
    /** [quiet] is true under Do Not Disturb: the text stays in the chat, nothing is spoken. */
    data class Reply(val text: String, val quiet: Boolean) : VoiceLoopEvent
    data object SpeechDone : VoiceLoopEvent
    data object Stop : VoiceLoopEvent
    /** [message] null means the error is already shown. */
    data class Fail(val message: String?) : VoiceLoopEvent
}

sealed interface VoiceLoopEffect {
    data object None : VoiceLoopEffect
    data object Listen : VoiceLoopEffect
    data class Submit(val text: String) : VoiceLoopEffect
    data class Speak(val text: String) : VoiceLoopEffect
    data object StopAll : VoiceLoopEffect
    data class Fail(val message: String?) : VoiceLoopEffect
}

data class VoiceLoopStep(val phase: VoiceLoopPhase, val effect: VoiceLoopEffect)

fun reduceVoiceLoop(phase: VoiceLoopPhase, event: VoiceLoopEvent): VoiceLoopStep {
    val stay = VoiceLoopStep(phase, VoiceLoopEffect.None)
    if (event is VoiceLoopEvent.Stop) {
        return if (phase == VoiceLoopPhase.IDLE) stay else VoiceLoopStep(VoiceLoopPhase.IDLE, VoiceLoopEffect.StopAll)
    }
    if (event is VoiceLoopEvent.Fail) {
        return if (phase == VoiceLoopPhase.IDLE) stay else VoiceLoopStep(VoiceLoopPhase.IDLE, VoiceLoopEffect.Fail(event.message))
    }
    return when (phase) {
        VoiceLoopPhase.IDLE -> if (event is VoiceLoopEvent.Start) VoiceLoopStep(VoiceLoopPhase.LISTENING, VoiceLoopEffect.Listen) else stay
        VoiceLoopPhase.LISTENING -> when {
            event is VoiceLoopEvent.Heard && event.text.isBlank() ->
                VoiceLoopStep(VoiceLoopPhase.IDLE, VoiceLoopEffect.Fail("Didn't catch that. Tap the orb to try again."))
            event is VoiceLoopEvent.Heard -> VoiceLoopStep(VoiceLoopPhase.SENDING, VoiceLoopEffect.Submit(event.text.trim()))
            else -> stay
        }
        VoiceLoopPhase.SENDING -> if (event is VoiceLoopEvent.Submitted) VoiceLoopStep(VoiceLoopPhase.WAITING, VoiceLoopEffect.None) else stay
        VoiceLoopPhase.WAITING -> when {
            event is VoiceLoopEvent.Reply && (event.quiet || event.text.isBlank()) -> VoiceLoopStep(VoiceLoopPhase.IDLE, VoiceLoopEffect.StopAll)
            event is VoiceLoopEvent.Reply -> VoiceLoopStep(VoiceLoopPhase.SPEAKING, VoiceLoopEffect.Speak(event.text))
            else -> stay
        }
        VoiceLoopPhase.SPEAKING -> if (event is VoiceLoopEvent.SpeechDone) VoiceLoopStep(VoiceLoopPhase.LISTENING, VoiceLoopEffect.Listen) else stay
    }
}

fun voiceLoopLabel(phase: VoiceLoopPhase): String = when (phase) {
    VoiceLoopPhase.IDLE -> ""
    VoiceLoopPhase.LISTENING -> "Listening"
    VoiceLoopPhase.SENDING -> "Sending"
    VoiceLoopPhase.WAITING -> "Waiting for reply…"
    VoiceLoopPhase.SPEAKING -> "Speaking"
}

/** The assistant's final answer for [submission]'s turn, once the reply has synced. */
fun finalReplyFor(submission: SubmittedTurn?, chat: ChatSnapshot?): String? {
    if (submission == null || chat == null || submission.threadId != chat.threadId) return null
    if (submission.phase != SubmissionPhase.COMPLETED) return null
    val turn = submission.nativeTurnId ?: return null
    return chat.messages.lastOrNull { it.turnId == turn && it.role == ChatRole.ASSISTANT && it.phase == ChatPhase.FINAL_ANSWER }?.text
}

const val MAX_SPOKEN_CHARS = 1_500

/** Markdown reduced to speakable plain text, capped at [MAX_SPOKEN_CHARS]. */
fun speechPlainText(markdown: String): String {
    var text = markdown.replace("\r\n", "\n")
    text = Regex("```[\\s\\S]*?```").replace(text, " code omitted. ")
    text = Regex("!?\\[([^\\]]*)]\\([^)]*\\)").replace(text, "$1")
    text = Regex("(?m)^\\s{0,3}(#{1,6}|>|[-*+]|\\d+\\.)\\s+").replace(text, "")
    text = text.replace(Regex("[`*_~]+"), "")
    text = Regex("\\s*\\n\\s*").replace(text, ". ").replace(Regex("\\.(\\s*\\.)+"), ".")
    text = Regex("\\s{2,}").replace(text, " ").trim()
    return if (text.length <= MAX_SPOKEN_CHARS) text else text.take(MAX_SPOKEN_CHARS).trimEnd() + "…"
}
