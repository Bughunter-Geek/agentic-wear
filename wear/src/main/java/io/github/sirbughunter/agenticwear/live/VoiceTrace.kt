package io.github.sirbughunter.agenticwear.live

import android.os.SystemClock
import android.util.Log
import org.json.JSONObject

internal object VoiceTrace {
    @Volatile private var window: VoiceTraceWindow? = null
    fun begin(callId: String, threadId: String) {
        window = VoiceTraceWindow(SystemClock::elapsedRealtime, callId, threadId)
        event(VoiceTraceStage.BEGIN, atEpochMs = System.currentTimeMillis())
    }
    fun event(stage: VoiceTraceStage, state: String? = null, count: Int? = null, durationMs: Long? = null, atEpochMs: Long? = null) {
        window?.event(stage, state, count, durationMs, atEpochMs)?.let { Log.i("AgenticVoiceTrace", JSONObject(it).toString()) }
    }
    fun events(): List<Map<String, Any>> = window?.events().orEmpty()
    fun error(stage: VoiceTraceStage, error: Throwable) = event(stage, when (error) {
        is kotlinx.coroutines.TimeoutCancellationException -> "TIMEOUT"
        is java.io.IOException -> "IO"
        is LinkageError -> "LINKAGE"
        else -> "OTHER"
    })
}
