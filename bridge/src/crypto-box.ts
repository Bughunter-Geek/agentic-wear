import { randomUUID, webcrypto } from "node:crypto";
import type { WireEnvelope } from "./schemas.js";

const cryptoApi = webcrypto as Crypto;
const encoder = new TextEncoder();
const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export type BridgeKeyPair = { publicKeyBase64: string; privateKeyMaterial: string };

export async function generateBridgeKeyPair(): Promise<BridgeKeyPair> {
  const pair = await cryptoApi.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  if (!("publicKey" in pair)) throw new Error("Could not generate an ECDH key pair");
  const [publicKey, privateKey] = await Promise.all([
    cryptoApi.subtle.exportKey("spki", pair.publicKey),
    cryptoApi.subtle.exportKey("jwk", pair.privateKey),
  ]);
  if (!privateKey.d || !/^[A-Za-z0-9_-]{43}$/u.test(privateKey.d)) {
    throw new Error("Could not export compact P-256 private key material");
  }
  return {
    publicKeyBase64: Buffer.from(publicKey).toString("base64"),
    privateKeyMaterial: `p256-d:${privateKey.d}`,
  };
}

export class CryptoBox {
  private sharedKey: CryptoKey | null = null;

  constructor(
    private readonly pairId: string,
    private readonly privateKeyMaterial: string,
    private readonly bridgePublicKeyBase64: string,
    private watchPublicKeyBase64: string | null,
  ) {}

  setWatchPublicKey(value: string): void {
    if (this.watchPublicKeyBase64 !== value) {
      this.watchPublicKeyBase64 = value;
      this.sharedKey = null;
    }
  }

  async encrypt(payload: Record<string, unknown>): Promise<WireEnvelope> {
    const messageId = randomUUID();
    const sentAt = Date.now();
    const sender = "bridge" as const;
    const recipient = "watch" as const;
    const nonce = cryptoApi.getRandomValues(new Uint8Array(12));
    const encrypted = await cryptoApi.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: bufferSource(aad(1, messageId, sender, recipient, sentAt)),
        tagLength: 128,
      },
      await this.key(),
      encoder.encode(JSON.stringify(payload)),
    );
    return {
      version: 1,
      messageId,
      sender,
      recipient,
      sentAt,
      nonce: Buffer.from(nonce).toString("base64"),
      ciphertext: Buffer.from(encrypted).toString("base64"),
    };
  }

  async decrypt(envelope: WireEnvelope): Promise<unknown> {
    if (envelope.sender !== "watch" || envelope.recipient !== "bridge") throw new Error("Unexpected envelope route");
    const now = Date.now();
    if (envelope.sentAt > now + MAX_FUTURE_SKEW_MS || now - envelope.sentAt >= MAX_MESSAGE_AGE_MS) {
      throw new Error("Envelope timestamp is outside the accepted window");
    }
    const nonce = Buffer.from(envelope.nonce, "base64");
    if (nonce.byteLength !== 12) throw new Error("Invalid envelope nonce");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    if (ciphertext.byteLength > 768 * 1_024) throw new Error("Envelope is too large");
    const plaintext = await cryptoApi.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: bufferSource(aad(
          envelope.version,
          envelope.messageId,
          envelope.sender,
          envelope.recipient,
          envelope.sentAt,
        )),
        tagLength: 128,
      },
      await this.key(),
      ciphertext,
    );
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(plaintext));
  }

  private async key(): Promise<CryptoKey> {
    if (this.sharedKey) return this.sharedKey;
    if (!this.watchPublicKeyBase64) throw new Error("The watch has not completed pairing yet");
    const [privateKey, publicKey] = await Promise.all([
      this.importPrivateKey(),
      cryptoApi.subtle.importKey(
        "spki",
        Buffer.from(this.watchPublicKeyBase64, "base64"),
        { name: "ECDH", namedCurve: "P-256" },
        false,
        [],
      ),
    ]);
    const shared = await cryptoApi.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
    const salt = await cryptoApi.subtle.digest("SHA-256", encoder.encode(`agentic-wear-v1:${this.pairId}`));
    const material = await cryptoApi.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    this.sharedKey = await cryptoApi.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("relay-e2ee") },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    return this.sharedKey;
  }

  private async importPrivateKey(): Promise<CryptoKey> {
    if (!this.privateKeyMaterial.startsWith("p256-d:")) {
      return cryptoApi.subtle.importKey(
        "pkcs8",
        Buffer.from(this.privateKeyMaterial, "base64"),
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveBits"],
      );
    }
    const d = this.privateKeyMaterial.slice("p256-d:".length);
    if (!/^[A-Za-z0-9_-]{43}$/u.test(d)) throw new Error("Invalid compact P-256 private key material");
    const bridgePublicKey = await cryptoApi.subtle.importKey(
      "spki",
      Buffer.from(this.bridgePublicKeyBase64, "base64"),
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    );
    const publicJwk = await cryptoApi.subtle.exportKey("jwk", bridgePublicKey);
    if (!publicJwk.x || !publicJwk.y) throw new Error("Invalid bridge public key");
    return cryptoApi.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: publicJwk.x,
        y: publicJwk.y,
        d,
        ext: true,
        key_ops: ["deriveBits"],
      },
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
  }
}

function aad(version: number, id: string, sender: string, recipient: string, sentAt: number): Uint8Array {
  return encoder.encode(`${version}|${id}|${sender}|${recipient}|${sentAt}`);
}

function bufferSource(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer;
}
