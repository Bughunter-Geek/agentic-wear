package io.github.sirbughunter.agenticwear.model
import org.junit.Assert.*
import org.junit.Test
class DraftEditingTest {
 @Test fun `correction preserves original and undo restores prior draft`() {
  val base=Transcript("one","Yesterday I bought green flowers.",null,rawText="Yesterday red, no green flowers.")
  val edited=Transcript("two","Yesterday I bought blue flowers.",null).withEditBase(base)
  assertEquals(base.rawText,edited.rawText)
  assertEquals(base.text,edited.undoDraft().text)
  assertEquals(base.rawText,edited.undoDraft().rawText)
 }
 @Test fun `restore raw remains reversible and selecting ambiguity clears choices`() {
  val draft=Transcript("one","Open it.",null,rawText="Do not delete it. Open it.",editChoices=listOf("option one","option two"))
  val restored=draft.editedDraft(draft.rawText!!)
  assertEquals(draft.text,restored.undoDraft().text)
  assertTrue(restored.editChoices.isEmpty())
  assertEquals(draft.rawText,restored.rawText)
 }
 @Test fun `same text dismisses edit choices without replacing undo`() {
  val draft=Transcript("one","current",null,undoText="previous",editChoices=listOf("a","b"))
  assertEquals("previous",draft.editedDraft("current").undoText)
  assertTrue(draft.editedDraft("current").editChoices.isEmpty())
 }
 @Test fun `pending recording and transcribing each block repeated actions`() {
  assertTrue(draftActionAllowed(false,false,false))
  for (p in listOf(true,false)) for (r in listOf(true,false)) for (t in listOf(true,false))
   assertEquals(!p && !r && !t,draftActionAllowed(p,r,t))
 }
}
