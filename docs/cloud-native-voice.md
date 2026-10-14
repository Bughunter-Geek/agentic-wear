# Full-duplex voice for browser cloud chats

Talk opens the same live-call activity for local, Dot and ordinary cloud chats. Ordinary cloud voice no longer implicitly starts the transcription/read-aloud loop. Dictation remains an explicit separate action.

The paired browser receiver advertises native voice only when the current cloud document has its usable native Start voice chat control. Call control and authentication stay with that browser client. Its WebRTC offer and answer belong to the Watch microphone/speaker endpoint. Cloud RPC calls wait for Watch media, its event channel and the native input-release signal; they do not wait for Dot HTTP allocation/attach.

Commands and events are scoped to the observed URL, document, thread and call. Existing personal browser calls prevent takeover. Startup cancellation uses the owned cloud Cancel voice chat control; navigation cannot cancel another chat's call. Bluetooth uses the verified delegated-browser capability. No audio, SDP, captions or credentials are added to diagnostic logs.

The Watch update and receiver/bridge update must be used together. Focused synthetic peer, browser-controller, mute-lease and paired-socket tests cover signaling boundaries. Physical audio and connectivity acceptance remain with the user.
