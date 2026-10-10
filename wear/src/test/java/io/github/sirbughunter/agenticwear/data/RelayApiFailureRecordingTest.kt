package io.github.sirbughunter.agenticwear.data

import com.sun.net.httpserver.HttpServer
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * Runs the real [RelayApi] against a loopback server. Only error paths are exercised: they need no
 * `org.json`, which is not available to JVM unit tests.
 */
class RelayApiFailureRecordingTest {
    private var server: HttpServer? = null

    @Before
    fun emptyLog() = RelayFailureLog.resetForTest()

    @After
    fun cleanUp() {
        server?.stop(0)
        RelayFailureLog.resetForTest()
    }

    private fun pairingFor(baseUrl: String) = Pairing(
        relayUrl = baseUrl,
        pairId = "pair-1",
        watchCredential = "credential-that-must-never-be-logged",
        bridgePublicKey = "bridge-key",
    )

    private fun serve(status: Int, hits: AtomicInteger): String {
        val http = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        http.createContext("/") { exchange ->
            hits.incrementAndGet()
            exchange.requestBody.readBytes()
            val body = """{"error":"secret relay detail"}""".toByteArray()
            exchange.sendResponseHeaders(status, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        http.start()
        server = http
        return "http://127.0.0.1:${http.address.port}"
    }

    @Test
    fun `an HTTP error is recorded once with its status and is not retried`() = runBlocking {
        val hits = AtomicInteger()
        val api = RelayApi()
        val before = System.currentTimeMillis()

        try {
            api.fetchInbox(pairingFor(serve(503, hits)))
            fail("expected a RelayException")
        } catch (error: RelayException) {
            assertEquals(503, error.status)
        }

        assertEquals(1, hits.get())
        val failures = RelayFailureLog.snapshot()
        assertEquals(1, failures.size)
        assertEquals("fetchInbox", failures[0].op)
        assertEquals(503, failures[0].status)
        assertEquals("RelayException", failures[0].errorClass)
        assertTrue(failures[0].at in before..System.currentTimeMillis())
    }

    @Test
    fun `a client error is recorded with its own status`() = runBlocking {
        val hits = AtomicInteger()
        try {
            RelayApi().fetchInbox(pairingFor(serve(404, hits)))
            fail("expected a RelayException")
        } catch (error: RelayException) {
            assertEquals(404, error.status)
        }

        assertEquals(listOf(404), RelayFailureLog.snapshot().map { it.status })
    }

    @Test
    fun `every failed transport attempt is recorded before the retries give up`() = runBlocking {
        val closedPort = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { it.localPort }

        try {
            RelayApi().fetchInbox(pairingFor("http://127.0.0.1:$closedPort"))
            fail("expected an IOException")
        } catch (error: IOException) {
            assertNotNull(error.cause)
        }

        val failures = RelayFailureLog.snapshot()
        // One first attempt plus the two bounded retries.
        assertEquals(3, failures.size)
        failures.forEach {
            assertEquals("fetchInbox", it.op)
            assertEquals(0, it.status)
            assertEquals("ConnectException", it.errorClass)
        }
        assertTrue(failures.map { it.at }.zipWithNext().all { (a, b) -> a <= b })
    }

    @Test
    fun `recorded failures carry no url, credential or relay error text`() = runBlocking {
        val hits = AtomicInteger()
        try {
            RelayApi().fetchInbox(pairingFor(serve(500, hits)))
        } catch (_: RelayException) {
        }

        val text = RelayFailureLog.snapshot().toString()
        assertFalse(text.contains("127.0.0.1"))
        assertFalse(text.contains("credential-that-must-never-be-logged"))
        assertFalse(text.contains("pair-1"))
        assertFalse(text.contains("secret relay detail"))
    }
}
