package io.github.sirbughunter.agenticwear.model

/** One reversible edit. Raw recognition is never overwritten by a correction. */
fun Transcript.editedDraft(value: String): Transcript = copy(
    text = value.take(MAX_TRANSCRIPT_CHARS),
    undoText = text.takeIf { it != value } ?: undoText,
    editChoices = emptyList(), editNotice = null,
)
fun Transcript.undoDraft(): Transcript = undoText?.let { copy(text = it, undoText = null, editChoices = emptyList(), editNotice = null) } ?: this
fun Transcript.withEditBase(base: Transcript): Transcript = copy(rawText = base.rawText ?: base.text, undoText = base.text)
fun draftActionAllowed(pending: Boolean, recording: Boolean, transcribing: Boolean): Boolean = !pending && !recording && !transcribing
