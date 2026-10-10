package io.github.sirbughunter.agenticwear.live

import android.content.Context
import livekit.org.webrtc.*
import livekit.org.webrtc.audio.JavaAudioDeviceModule
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import org.json.JSONObject

/** Native equivalent of Codex's RTCPeerConnection + microphone + oai-events channel. */
class NativeLivePeer(
    context: Context,
    private val onState: (String) -> Unit,
    private val onCaption: (String) -> Unit,
) : LivePeer {
    @Volatile private var closed = false
    /**
     * Serializes close() with short native calls made from other threads (the offer coroutine now runs on
     * Dispatchers.Default while end()/onDestroy() close the peer on Main). Never held across a suspension
     * point or inside a WebRTC observer callback.
     */
    private val lifecycle = Any()
    private val audioEnergy = mutableMapOf<String, VoiceAudioEnergy>()
    private val completeOffer = CompleteVoiceOffer()
    private lateinit var audioDevice: JavaAudioDeviceModule
    private lateinit var factory: PeerConnectionFactory
    private lateinit var source: AudioSource
    private lateinit var microphone: AudioTrack
    private lateinit var connection: PeerConnection
    private lateinit var events: DataChannel

    init {
        try {
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions
            .builder(context.applicationContext).createInitializationOptions())
        audioDevice = JavaAudioDeviceModule.builder(context.applicationContext)
            .setUseHardwareAcousticEchoCanceler(true)
            .setUseHardwareNoiseSuppressor(true)
            .createAudioDeviceModule()
        factory = PeerConnectionFactory.builder().setAudioDeviceModule(audioDevice).createPeerConnectionFactory()
        source = factory.createAudioSource(MediaConstraints())
        microphone = factory.createAudioTrack("watch-microphone", source)
        val config = PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        connection = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                VoiceTrace.event(VoiceTraceStage.ICE_STATE, state?.name)
                if (!closed && state == PeerConnection.IceConnectionState.FAILED) onState("failed")
            }
            override fun onConnectionChange(state: PeerConnection.PeerConnectionState?) {
                VoiceTrace.event(VoiceTraceStage.PEER_STATE, state?.name)
                if (!closed) when (state) {
                    PeerConnection.PeerConnectionState.CONNECTED -> onState("connected")
                    PeerConnection.PeerConnectionState.FAILED -> onState("failed")
                    PeerConnection.PeerConnectionState.DISCONNECTED -> onState("disconnected")
                    else -> Unit
                }
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
                VoiceTrace.event(VoiceTraceStage.ICE_GATHERING, state?.name)
                if (state == PeerConnection.IceGatheringState.COMPLETE) completeOffer.gathered()
            }
            override fun onIceCandidate(candidate: IceCandidate?) {
                if (candidate != null) VoiceTrace.event(VoiceTraceStage.ICE_CANDIDATE)
            }
            override fun onIceCandidateError(event: IceCandidateErrorEvent?) {
                VoiceTrace.event(VoiceTraceStage.CANDIDATE_ERROR, count = event?.errorCode)
            }
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
            override fun onAddStream(stream: MediaStream?) = Unit
            override fun onRemoveStream(stream: MediaStream?) = Unit
            override fun onDataChannel(channel: DataChannel?) = Unit
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) = Unit
        }) ?: error("Could not create WebRTC audio transport")
        connection.addTrack(microphone, listOf("watch-voice"))
        events = connection.createDataChannel("oai-events", DataChannel.Init())
        events.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previous: Long) = Unit
            override fun onStateChange() {
                VoiceTrace.event(VoiceTraceStage.CHANNEL_STATE, events.state().name)
                if (!closed && events.state() == DataChannel.State.CLOSED) onState("failed")
            }
            override fun onMessage(buffer: DataChannel.Buffer?) {
                if (closed || buffer == null || buffer.binary || buffer.data.remaining() > 65_536) return
                val bytes = ByteArray(buffer.data.remaining()); buffer.data.get(bytes)
                runCatching {
                    val event = JSONObject(String(bytes, Charsets.UTF_8))
                    val type = event.optString("type")
                    when (type) {
                        "input_audio_buffer.speech_started" -> onState("listening")
                        "input_audio_buffer.speech_stopped", "response.created" -> onState("thinking")
                        "output_audio_buffer.started" -> onState("speaking")
                        "output_audio_buffer.stopped", "output_audio_buffer.cleared" -> onState("ready")
                        "response.done" -> onState("response.done")
                    }
                    if (type.contains("transcript") && type.endsWith(".delta")) {
                        val delta = event.optString("delta")
                        if (delta.isNotBlank()) onCaption(delta.take(2048))
                    }
                }
            }
        })
        } catch (error: Throwable) {
            close()
            throw error
        }
    }

    /** Runs a short, non-suspending native call under the lifecycle lock; throws if the peer is closed. */
    private inline fun <T> whileOpen(block: () -> T): T = synchronized(lifecycle) {
        if (closed) throw java.util.concurrent.CancellationException("Voice peer closed")
        block()
    }

    /** Runs a short, non-suspending native call under the lifecycle lock; does nothing if the peer is closed. */
    private inline fun ifOpen(block: () -> Unit) {
        synchronized(lifecycle) { if (!closed) block() }
    }

    override fun levels(callback: (Float, Float) -> Unit) {
        if (closed || !::connection.isInitialized) return
        ifOpen {
            connection.getStats { report ->
                if (!closed) {
                    synchronized(audioEnergy) {
                        if (closed) return@getStats
                        val currentIds = mutableSetOf<String>()
                        fun level(type: String) = report.statsMap.entries.filter { (_, stat) -> stat.type == type &&
                            (stat.members["kind"] == "audio" || stat.members["mediaType"] == "audio") }
                            .map { (id, stat) ->
                                currentIds.add(id)
                                fun number(key: String) = (stat.members[key] as? Number)?.toDouble()
                                audioEnergy.getOrPut(id) { VoiceAudioEnergy() }.sample(number("audioLevel"),
                                    number("totalAudioEnergy"), number("totalSamplesDuration"))
                            }.maxOrNull() ?: 0f
                        val input = level("media-source")
                        val output = level("inbound-rtp")
                        audioEnergy.keys.retainAll(currentIds)
                        callback(input, output)
                    }
                }
            }
        }
    }

    override suspend fun offer(): String {
        val offer = suspendCancellableCoroutine<SessionDescription> { cont ->
            try {
                whileOpen {
                    connection.createOffer(object : SdpObserver {
                        override fun onCreateSuccess(sdp: SessionDescription?) {
                            if (cont.isActive && sdp != null) cont.resume(sdp)
                        }
                        override fun onCreateFailure(message: String?) {
                            if (cont.isActive) cont.resumeWithException(IllegalStateException("Could not create voice offer"))
                        }
                        override fun onSetSuccess() = Unit
                        override fun onSetFailure(message: String?) = Unit
                    }, MediaConstraints())
                }
            } catch (error: Throwable) {
                if (cont.isActive) cont.resumeWithException(error)
            }
        }
        setDescription(offer, local = true)
        if (whileOpen { connection.iceGatheringState() } == PeerConnection.IceGatheringState.COMPLETE) completeOffer.gathered()
        return completeOffer.await({
            whileOpen { connection.localDescription.description }.also { sdp ->
                val count = sdp.lineSequence().count { it.startsWith("a=candidate:") }
                VoiceTrace.event(if (count == 0) VoiceTraceStage.OFFER_NO_CANDIDATE else VoiceTraceStage.OFFER_READY, count = count)
            }
        })
    }

    override suspend fun answer(sdp: String) = setDescription(SessionDescription(SessionDescription.Type.ANSWER, sdp), false)

    private suspend fun setDescription(sdp: SessionDescription, local: Boolean) = suspendCancellableCoroutine<Unit> { cont ->
        val observer = object : SdpObserver {
            override fun onSetSuccess() { if (cont.isActive) cont.resume(Unit) }
            override fun onSetFailure(message: String?) {
                if (cont.isActive) cont.resumeWithException(IllegalStateException("Voice negotiation failed"))
            }
            override fun onCreateSuccess(sdp: SessionDescription?) = Unit
            override fun onCreateFailure(message: String?) = Unit
        }
        try {
            whileOpen { if (local) connection.setLocalDescription(observer, sdp) else connection.setRemoteDescription(observer, sdp) }
        } catch (error: Throwable) {
            if (cont.isActive) cont.resumeWithException(error)
        }
    }

    override fun mute(muted: Boolean) { ifOpen { microphone.setEnabled(!muted) } }

    companion object {
        /**
         * Starts WebRTC's Java network monitor at call start, before the first peer exists. A peer
         * created immediately can otherwise finish ICE gathering before WebRTC knows the watch's
         * networks (traced as OFFER_NO_CANDIDATE). Returns a release; the monitor is reference-counted.
         */
        fun warmUpNetworkMonitor(context: Context): () -> Unit {
            val monitor = NetworkMonitor.getInstance()
            if (runCatching { monitor.startMonitoring(context.applicationContext) }.isFailure) return {}
            var released = false
            return { if (!released) { released = true; runCatching { monitor.stopMonitoring() } } }
        }
    }
    override fun close() {
        synchronized(lifecycle) {
            if (closed) return
            closed = true
            synchronized(audioEnergy) { audioEnergy.clear() }
            completeOffer.close()
            // Constructor failures must release every resource already created.
            if (::events.isInitialized) {
                runCatching { events.unregisterObserver() }; runCatching { events.close() }; runCatching { events.dispose() }
            }
            if (::connection.isInitialized) { runCatching { connection.close() }; runCatching { connection.dispose() } }
            if (::microphone.isInitialized) runCatching { microphone.dispose() }
            if (::source.isInitialized) runCatching { source.dispose() }
            if (::factory.isInitialized) runCatching { factory.dispose() }
            if (::audioDevice.isInitialized) runCatching { audioDevice.release() }
        }
    }
}
