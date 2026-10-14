# Cloud voice reply playback

Private build 112 moves automatic interruption monitoring after the TTS engine reports playback start, instead of opening the microphone before speech has begun. Late/cancelled utterance callbacks cannot arm a new monitor. Automatic interruption requires an enabled echo canceller controlled by the monitor; without that guarantee the user can tap the orb to interrupt.

Failed speech initialization, stalled startup (10 seconds), and completion without a playback-start event report a speech failure rather than leaving a silent Speaking state. Pending speech is cleared on timeout/cancel so delayed initialization cannot speak an old reply. Metadata-only loop traces distinguish playback start, completion, failure and unavailable interruption monitoring.

Evidence: the reported cloud session matched a reply and then detected an interruption about 2.5 seconds later; the user did not observe Speaking. This confirms premature interruption in that session but does not prove whether the mic captured speaker echo, ambient sound or user speech. No unchanged physical reproduction was requested. Device acceptance belongs to the user; no emulator or real-account test calls are made by the agent.
