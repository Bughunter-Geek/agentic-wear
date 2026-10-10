package io.github.sirbughunter.agenticwear.data
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class InboxPublicationTest {
 @Test fun `validated draft is published and caller returns while ACK is blocked`() = runBlocking {
  val scope=CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
  val release=CompletableDeferred<Unit>()
  var draftVisible=false
  var ackFinished=false
  val queue=InboxAcknowledgements(scope)
  publishBeforeAcknowledgement({draftVisible=true},queue) { assertTrue(draftVisible); release.await(); ackFinished=true }
  assertTrue(draftVisible)
  assertFalse(ackFinished)
  release.complete(Unit); yield()
  assertTrue(ackFinished)
  scope.cancel()
 }
 @Test fun `ACK failure cannot remove published draft and next ACK can be queued`() = runBlocking {
  val scope=CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
  val queue=InboxAcknowledgements(scope,1)
  var current="previous"
  publishBeforeAcknowledgement({current="corrected"},queue) { throw IllegalStateException("offline") }
  assertEquals("corrected",current)
  assertTrue(queue.schedule {})
  scope.cancel()
 }
 @Test fun `background queue is bounded and frees capacity on completion`() = runBlocking {
  val scope=CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
  val queue=InboxAcknowledgements(scope,1)
  val release=CompletableDeferred<Unit>()
  assertTrue(queue.schedule {release.await()})
  assertFalse(queue.schedule {error("must not run")})
  release.complete(Unit);yield()
  assertTrue(queue.schedule {})
  scope.cancel()
 }
}
