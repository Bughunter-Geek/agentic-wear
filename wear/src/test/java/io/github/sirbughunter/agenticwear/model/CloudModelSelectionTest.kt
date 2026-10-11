package io.github.sirbughunter.agenticwear.model

import io.github.sirbughunter.agenticwear.data.PayloadCodec
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CloudModelSelectionTest {
    private val info = CloudModelInfo("GPT-6.1 Sol", listOf("GPT-6.1 Sol", "GPT-6 Astra"), 2, "Medium", listOf("Light", "Low", "Medium", "High", "Max"))

    private fun session(extra: JSONObject.() -> Unit) = JSONObject().put("version", 1).put("kind", "sessions.snapshot").put(
        "sessions", JSONArray().put(JSONObject().put("id", "c1").put("title", "Cloud").put("source", "cloud").apply(extra)))

    @Test
    fun `decodes cloud fields and tolerates absence`() {
        val s = PayloadCodec.decodeSessions(session {
            put("cloudModel", "GPT-6.1 Sol"); put("cloudModels", JSONArray(listOf("GPT-6.1 Sol", "GPT-6 Astra")))
            put("cloudEffort", JSONObject().put("index", 2).put("label", "Medium")); put("cloudEfforts", JSONArray(listOf("Light", "", "Medium")))
        }).single()
        assertEquals("GPT-6.1 Sol", s.cloud!!.model)
        assertEquals(2, s.cloud!!.effortIndex)
        assertEquals(listOf("Light", "Level 2", "Medium"), s.cloud!!.efforts)
        assertNull(PayloadCodec.decodeSessions(session { }).single().cloud)
        val restored = PayloadCodec.sessionsFromJson(PayloadCodec.sessionsToJson(listOf(s))).single()
        assertEquals(s.cloud, restored.cloud)
    }

    @Test
    fun `picker visibility`() {
        assertEquals(ModelPicker.MAC, modelPickerFor(null, null))
        assertEquals(ModelPicker.NONE, modelPickerFor("dot", info))
        assertEquals(ModelPicker.NONE, modelPickerFor("cloud", null))
        assertEquals(ModelPicker.CLOUD, modelPickerFor("cloud", info))
    }

    @Test
    fun `only changed advertised values are sent`() {
        assertEquals(CloudSelection(null, null), cloudSelectionToSend(info, null, null))
        assertEquals(CloudSelection(null, null), cloudSelectionToSend(info, "GPT-6.1 Sol", 2))
        assertEquals(CloudSelection("GPT-6 Astra", 4), cloudSelectionToSend(info, "GPT-6 Astra", 4))
        assertEquals(CloudSelection(null, 0), cloudSelectionToSend(info, "Unknown", 0))
        assertEquals(CloudSelection(null, null), cloudSelectionToSend(info, null, 9))
        assertEquals(CloudSelection(null, null), cloudSelectionToSend(null, "x", 1))
    }

    @Test
    fun `payload carries cloud model with spaces and effort index only when set`() {
        val withCloud = JSONObject(PayloadCodec.encode(BridgePayload.SubmitTurn("r1", "c1", "hi", "GPT-6 Astra", cloudEffortIndex = 4, cloudModel = true)))
        assertEquals("GPT-6 Astra", withCloud.getString("model"))
        assertEquals(4, withCloud.getInt("cloudEffortIndex"))
        val plain = JSONObject(PayloadCodec.encode(BridgePayload.SubmitTurn("r2", "c1", "hi")))
        assertEquals(false, plain.has("model") || plain.has("cloudEffortIndex"))
    }
}
