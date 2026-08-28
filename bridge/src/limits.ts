export const MAX_AUDIO_BYTES = 1_300_000;
export const MAX_AUDIO_BASE64_CHARS = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
export const MAX_TRANSCRIPT_CHARS = 12_000;

// A transcription request is JSON containing base64 audio, then encrypted with
// AES-GCM and base64-encoded again for the relay envelope.
export const MAX_INBOUND_CIPHERTEXT_BYTES = 1_800_000;
export const MAX_INBOUND_CIPHERTEXT_BASE64_CHARS = Math.ceil(MAX_INBOUND_CIPHERTEXT_BYTES / 3) * 4;
export const MAX_RELAY_MESSAGE_BYTES = 2_500_000;
