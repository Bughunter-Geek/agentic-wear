import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CryptoBox, generateBridgeKeyPair } from "../src/crypto-box.js";
import type { WireEnvelope } from "../src/schemas.js";

const cryptoApi = webcrypto as Crypto;
const encoder = new TextEncoder();

describe("CryptoBox", () => {
  it("interoperates with the watch-side P-256/HKDF/AES-GCM format", async () => {
    const bridge = await generateBridgeKeyPair();
    const watch = await generateTestKeyPair();
    const pairId = "pair-id-for-interoperability-test-0000000000";
    const box = new CryptoBox(
      pairId,
      bridge.privateKeyMaterial,
      bridge.publicKeyBase64,
      watch.publicKeyBase64,
    );

    expect(bridge.privateKeyMaterial).toMatch(/^p256-d:[A-Za-z0-9_-]{43}$/u);
    expect(bridge.privateKeyMaterial.length).toBeLessThan(128);

    const toWatch = await box.encrypt({ version: 1, kind: "sessions.snapshot", sessions: [] });
    expect(await decryptAsWatch(pairId, watch.privateKeyBase64, bridge.publicKeyBase64, toWatch)).toEqual({
      version: 1,
      kind: "sessions.snapshot",
      sessions: [],
    });

    const toBridge = await encryptAsWatch(
      pairId,
      watch.privateKeyBase64,
      bridge.publicKeyBase64,
      { version: 1, kind: "session.sync", requestId: "request-1" },
    );
    expect(await box.decrypt(toBridge)).toEqual({ version: 1, kind: "session.sync", requestId: "request-1" });
  });

  it("rejects messages too far in the future instead of extending their replay window", async () => {
    const bridge = await generateBridgeKeyPair();
    const watch = await generateTestKeyPair();
    const pairId = "pair-id-for-timestamp-test-000000000000000";
    const box = new CryptoBox(
      pairId,
      bridge.privateKeyMaterial,
      bridge.publicKeyBase64,
      watch.publicKeyBase64,
    );
    const future = await encryptAsWatch(
      pairId,
      watch.privateKeyBase64,
      bridge.publicKeyBase64,
      { version: 1, kind: "session.sync", requestId: "future-request" },
      Date.now() + 5 * 60 * 1_000 + 1_000,
    );
    await expect(box.decrypt(future)).rejects.toThrow("timestamp is outside");
  });
});

async function generateTestKeyPair(): Promise<{ publicKeyBase64: string; privateKeyBase64: string }> {
  const pair = await cryptoApi.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  if (!("publicKey" in pair)) throw new Error("Could not generate test key pair");
  const [publicKey, privateKey] = await Promise.all([
    cryptoApi.subtle.exportKey("spki", pair.publicKey),
    cryptoApi.subtle.exportKey("pkcs8", pair.privateKey),
  ]);
  return {
    publicKeyBase64: Buffer.from(publicKey).toString("base64"),
    privateKeyBase64: Buffer.from(privateKey).toString("base64"),
  };
}

async function decryptAsWatch(
  pairId: string,
  privateKey: string,
  peerPublicKey: string,
  envelope: WireEnvelope,
): Promise<unknown> {
  const key = await sharedKey(pairId, privateKey, peerPublicKey);
  const plaintext = await cryptoApi.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytes(envelope.nonce),
      additionalData: aad(envelope),
      tagLength: 128,
    },
    key,
    bytes(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function encryptAsWatch(
  pairId: string,
  privateKey: string,
  peerPublicKey: string,
  payload: Record<string, unknown>,
  sentAt = Date.now(),
): Promise<WireEnvelope> {
  const envelope: WireEnvelope = {
    version: 1,
    messageId: "watch-message-1",
    sender: "watch",
    recipient: "bridge",
    sentAt,
    nonce: Buffer.from(cryptoApi.getRandomValues(new Uint8Array(12))).toString("base64"),
    ciphertext: "",
  };
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv: bytes(envelope.nonce), additionalData: aad(envelope), tagLength: 128 },
    await sharedKey(pairId, privateKey, peerPublicKey),
    encoder.encode(JSON.stringify(payload)),
  );
  envelope.ciphertext = Buffer.from(ciphertext).toString("base64");
  return envelope;
}

async function sharedKey(pairId: string, privateKey: string, publicKey: string): Promise<CryptoKey> {
  const own = await cryptoApi.subtle.importKey(
    "pkcs8",
    bytes(privateKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const peer = await cryptoApi.subtle.importKey(
    "spki",
    bytes(publicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const secret = await cryptoApi.subtle.deriveBits({ name: "ECDH", public: peer }, own, 256);
  const salt = await cryptoApi.subtle.digest("SHA-256", encoder.encode(`agentic-wear-v1:${pairId}`));
  const material = await cryptoApi.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return cryptoApi.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("relay-e2ee") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function bytes(value: string): ArrayBuffer {
  return Uint8Array.from(Buffer.from(value, "base64")).buffer;
}

function aad(envelope: WireEnvelope): ArrayBuffer {
  return encoder.encode(
    `${envelope.version}|${envelope.messageId}|${envelope.sender}|${envelope.recipient}|${envelope.sentAt}`,
  ).buffer;
}
