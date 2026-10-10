# Experimental Phonon-2 watch test

This is a Mac-side experimental provider, using the already installed isolated runtime. No watch APK or relay protocol changes. The watch's existing **Private Whisper** option routes to the bridge-selected backend; during this test that backend is **Phonon-2, English only**.

## Test on Pixel Watch 3

1. Open your already paired Agentic Wear app and refresh it while the Mac is awake and online.
2. In transcription settings choose **Private Whisper**, rather than device speech. The label is unchanged for this first experimental test.
3. Start an ordinary new voice draft (not Revise), grant the app's microphone permission if prompted, and speak a short English phrase such as “Please remind me to buy milk tomorrow morning.”
4. Stop/transcribe and inspect the editable text returned to the watch. Record the time from stopping recording to seeing the transcript and any wording errors.
5. Leave the draft unsent. Press Send only if you independently want to submit that text to Codex.

The phrase “Agentic Wear” may appear as “Agentic where”: that happened in the synthetic smoke test. Phonon-2 currently has no working hotword bias and does not support multilingual recognition. Use Whisper for multilingual speech. This test does not establish WER or noisy watch-speech accuracy.

## Selection and fallback

`AGENTIC_WEAR_TRANSCRIPTION_PROVIDER=phonon` selects the experimental backend. `local` restores Whisper; `openai` remains the existing explicit paid option. There is no silent automatic switch to a paid provider or to Whisper. Required absolute paths:

```
AGENTIC_WEAR_PHONON_PYTHON=/Users/bughunter/Documents/Codex/2026-10-01/task/phonon-2-lab/.venv/bin/python
AGENTIC_WEAR_PHONON_MODEL_DIR=/Users/bughunter/Documents/Codex/2026-10-01/task/phonon-2-lab/model
AGENTIC_WEAR_PHONON_CACHE=/Users/bughunter/Documents/Codex/2026-10-01/task/phonon-2-lab/cache
```

They are configured in this checkout's owner-only `.env.local`. The model and runtime remain outside the repo, with no global Python installation or package setup. The Python worker requires the tested fermion-research 0.2.4 and verifies the model container SHA-256 before loading. It disables Hub network access and implicit credentials, reuses `whisper_worker.decode_audio` for AAC/MP4-to-mono-16kHz float32 conversion, and warms before sending JSONL `ready`. Each recording gets a correlated `result` or bounded `error`. No HTTP listener, new exposed port or mic access on the Mac.

To switch the existing bridge back to Whisper **when no recording/transcription is in progress**:

```sh
python3 /Users/bughunter/Documents/Codex/2026-10-01/task/phonon-2-lab/integration/select-provider.py local
```

Use `phonon` instead of `local` to switch back. This restarts only the existing Agentic Wear bridge job; it does not change pairing or Keychain. Wait for startup before recording. If modifying settings manually, change only the provider in `.env.local`, then restart that same bridge job.

## Verification and deployment

Bridge type/lint checks, TypeScript suite and build pass; three Python protocol tests pass. The real synthetic-audio smoke test through the built Node transcriber and persistent Python child used 16 kHz mono AAC/ADTS at 32 kbps: 19,060 bytes. It returned the exact reference “Please remind me to buy milk tomorrow morning. The meeting starts at nine thirty.” on repeated requests. Prepare: 10.602 s; warm AAC-to-transcript wall: 0.172 s and 0.115 s. Invalid AAC was rejected and a later valid request succeeded in 0.117 s. No private audio or microphone was used. Evidence: `/Users/bughunter/Documents/Codex/2026-10-01/task/phonon-2-lab/evidence/integration-smoke.json`.

The installed LaunchAgent was already failing because its Node 25.2.1 path no longer existed. Its old Codex executable path was also obsolete. The same existing job was reloaded using `/opt/homebrew/bin/node` and `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`. No previous bridge PID existed, and saved pending turns were empty before activation. Pairing configuration bytes were unchanged immediately after activation; no tokens or Keychain secrets were altered.

The original plist and built JS are saved under `/Users/bughunter/Documents/Codex/2026-10-01/task/phonon-2-lab/integration/rollback/`. The original plist points to removed executables, so reverting the provider is the useful Whisper rollback; restoring that old plist would restore the original startup failure. The old source files are also backed up there. `.env.local` did not exist before activation.

Owner-only service logs: `~/.agentic-wear/bridge.stdout.log` and `bridge.stderr.log`. Phonon reported ready after 27.710 s on the service startup, launchd showed a running PID, and stdout confirmed “relay socket connected.” Doctor confirmed Codex CLI 0.159.2, existing credentials, authenticated watch pairing, and configured Phonon files.

The Desktop daemon's old `~/.codex/app-server-control/app-server-control.sock` is absent. The bridge is using its existing private App Server fallback; existing Desktop-chat availability is unverified. This does not prevent the independent transcription route. No changes were made to Codex, Aerial, pairing, permissions or app-server transport logic to work around it.

**Mac backend and relay verified; physical-watch recording, reachability, latency and displayed transcript remain unverified until the user performs the steps above.**

Expanded draft cleanup handles repeated common function words/contractions (including “it's it's”), lowercase incomplete prefixes such as “b because”, and hyphenated false-start chains. It preserves grammatical/emphatic repetitions (“had had”, “that that”, “is is”, “no no”, “very very”), acronyms, meaningful short words, quotes, code, filenames, paths and numbers. Literal/spelling instruction cues conservatively preserve the entire recognition. Ambiguous vocabulary outside the small repetition set is retained rather than guessed. Raw recognition remains in the transcription response when changed; build 51 lacks the build-52 Use original control. Existing AGENTIC_WEAR_PHONON_CLEAN_FILLERS=0 disables cleanup.

Prefix/phrase follow-up: “wil-will will” and “w will will” become “will”; “w way” becomes “way”; explicit “A-anyway” becomes “Anyway”. Narrow exact I/we + hope/think/guess/want restart chains collapse with spaces or commas. “it hope I hope” is retained because pronoun correction is uncertain, and arbitrary longer phrase echoes remain raw. Meaningful lowercase a/I, capital spelled letters, real short words, names, valid compounds and literal instructions are protected.


General vocabulary and latency follow-up: repeated normal words now collapse across spaces, commas and hyphens, including m my my my / mm- my,my,my. Explicit grammar/emphasis exceptions, uppercase acronyms, proper-name repetitions, quotes, code, paths, digits and literal/repetition instructions remain protected. Text-only cleanup cannot identify every deliberate emphasis; raw recognition is retained and cleanup can be disabled.

Metadata-only latency records use monotonic local clocks and contain no transcript, audio, request/thread/pair identifiers or private paths:
- transcription.ingress.timing: local relay command queue; decrypt/replay.
- phonon.worker.timing: ready wait; worker round trip; decode; inference; decoded clip duration; residual IPC/worker queue.
- transcription.bridge.timing: base64 decode; total transcriber; cleanup; explicit revision; encrypted result POST/relay response; bridge total.
Durations overlap/nest: do not add worker round trip to transcriber time. Result-relay timing includes the existing relay's synchronous FCM wake, not watch receipt or display. No cross-device wall-clock subtraction is used. Build51 does not expose upload, watch fetch/ack/display timings. Its polling schedule and inbox ACK before UI notification are candidates, not measured bottlenecks.

The optional AGENTIC_WEAR_PHONON_WARMUP_AUDIO points only to the lab's generated English AAC. It primes speech before worker ready using identical model/settings, discarding warm-up text. Synthetic tests showed first inference 3652ms then 43–54ms; later no-speech-warm-up baseline was 97ms, indicating cached compilation confounds causal attribution. With representative speech warm-up first request was 50ms inference and 90ms total; all references matched. These are local synthetic measurements, not a verified watch speedup. Roll back by removing this environment line and restarting the existing idle bridge; timing code does not change recognition settings.

Readability follow-up: mixed-case adjacent repeats collapse across spaces, commas or hyphens, without crossing a genuine sentence boundary. Clear a-and false starts require conjunction context; literal letters, initials and articles are preserved. Contextual that-that restart cleanup preserves complement/demonstrative grammar such as I know that that works and ambiguous bare/list pairs. Common say/type/write/repeat/list instruction protection now covers its clause instead of suppressing an entire recording. Grammar/emphasis safeguards remain; text-only intent is not perfectly recoverable and raw output remains retained.

Production pipeline follow-up: final supplied anyway-anyway snippet already passed the isolated active helper; whole recording context was not available and physical failure was not declared solved. Proven synthetic full-context defects (recording-wide spelling/literal guard, over-broad instruction spans, nonstandard whitespace) are corrected. Explicit literal instructions and quotes remain protected. Cleanup timing now records pipeline-guards-2, applied flag, literal fallback, protected-span count, input/output repeat counts and non-ASCII-whitespace presence, never words/IDs/text hashes. Remaining repeat counts may reflect intentional grammar/emphasis/literals. No lexical correction of it hopefully it is attempted. Exact full handler regressions and privacy tests verify the deployed compiled code, but do not replace physical watch acceptance.


## Build 53: local final-intent drafts and explicit voice editing

Staged 0.6.27-intent-alpha (versionCode 53) adds an explicit finalIntent request flag for the Phonon selection. Build 51 does not send it and retains the existing cleanup-only route. New watch initial drafts show a local Llama 3.1 8B rewrite while raw recognition remains independently accessible through Original, then Restore original. Undo reverses the previous edit or restore. The model gets JSON text data with no tools, no execution and no Codex/cloud call. It uses the existing localhost Ollama service and installed model, keeps it resident for two minutes, and falls back to the existing cleaned/current draft on busy/timeout/malformed/truncated output. This is an experimental semantic editor: review omissions and changes before manual Send. No perfect intent-preservation guarantee is made.

Edit explicitly opens voice capture using the existing microphone permission flow; denying permission restores the draft. Say change red to blue or replace red with blue for an exact whole-word replacement. Multiple matches keep the current draft and show separately labelled full-draft previews; choose Use match N or Keep draft. Complex corrections use the local model and return to review. Send is blocked while recording/transcribing/pending or while multiple edit choices remain unresolved. Cancellation retains the prior draft, stale cancelled results follow the existing request guard, and repeated Edit/Send actions are blocked. No automatic Send or recording happens on receiving a draft.

Synthetic staged-handler acceptance: So yesterday I bought red flowers. No, wait, I think it was green flowers. Yeah, it was green flowers. -> Yesterday I bought green flowers. A subsequent change green to blue -> Yesterday I bought blue flowers. red flowers beside red curtains + change red to blue asks which occurrence. The original remains retained. A complex make-it-concise request initially omitted Yesterday; a tighter lightweight prompt preserved it on retest, which is an example result rather than universal safety proof.

Build 53 is a local signed artifact, not a published/installed update. Public OTA publication requires separate user approval. Physical watch and visual review remain unverified; no UI or microphone was used by the agent. The server code was activated after zero owned/pending watch operations and no recent transcription. Phonon warmed in 32.108 seconds and the existing relay reconnected. Build 51 remains cleanup-only. A rollback copy of the prior bridge dist is retained in the isolated rewrite lab; config/pairing/LaunchAgent are unchanged. No pairing or key change is needed.
