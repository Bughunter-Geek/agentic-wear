package io.github.sirbughunter.agenticwear.live

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

internal data class CreatedVoiceTask(val id: String, val title: String)

internal fun canRequestVoiceStart(phase: String, permissionPending: Boolean): Boolean =
    !permissionPending && phase !in setOf("creating", "connecting", "live", "reconnecting", "ending")

/** Creation can be in flight when Cancel/back arrives. Finish receiving its
 * durable acknowledgment without allowing that canceled operation to open media. */
internal suspend fun createAndConnectVoiceTask(
    create: suspend () -> CreatedVoiceTask,
    stillCurrent: () -> Boolean,
    select: (CreatedVoiceTask) -> Unit,
    connect: (CreatedVoiceTask) -> Unit,
) {
    val task = withContext(NonCancellable + Dispatchers.IO) { create() }
    if (!stillCurrent()) return
    select(task)
    connect(task)
}
