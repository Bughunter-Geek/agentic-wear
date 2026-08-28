import { webcrypto } from "node:crypto";

const cryptoApi = webcrypto as Crypto;
const encoder = new TextEncoder();
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const pairingSalt = encoder.encode("agentic-wear-pair-auth-v2");
const pairIdDomain = encoder.encode("agentic-wear-pair-id-v2\0");
const pbkdf2Iterations = 120_000;

export const pairingCodeLength = 8;

export class PairingAuthenticator {
  private constructor(
    readonly pairId: string,
    readonly encodedSecret: string,
    private readonly key: CryptoKey,
  ) {}

  static async fromCode(value: string): Promise<PairingAuthenticator> {
    const code = normalizePairingCode(value);
    const material = await cryptoApi.subtle.importKey(
      "raw",
      encoder.encode(code),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const secret = new Uint8Array(await cryptoApi.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: pairingSalt, iterations: pbkdf2Iterations },
      material,
      256,
    ));
    return PairingAuthenticator.fromBytes(secret);
  }

  static async fromEncodedSecret(value: string): Promise<PairingAuthenticator> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new Error("Stored pairing authenticator is invalid");
    return PairingAuthenticator.fromBytes(new Uint8Array(Buffer.from(value, "base64url")));
  }

  async createProof(role: "bridge" | "watch", bridgePublicKey: string, watchPublicKey: string): Promise<string> {
    const signature = await cryptoApi.subtle.sign(
      "HMAC",
      this.key,
      encoder.encode(pairingTranscript(this.pairId, role, bridgePublicKey, watchPublicKey)),
    );
    return Buffer.from(signature).toString("base64url");
  }

  async verifyProof(
    role: "bridge" | "watch",
    bridgePublicKey: string,
    watchPublicKey: string,
    proof: string,
  ): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(proof)) return false;
    return cryptoApi.subtle.verify(
      "HMAC",
      this.key,
      Buffer.from(proof, "base64url"),
      encoder.encode(pairingTranscript(this.pairId, role, bridgePublicKey, watchPublicKey)),
    );
  }

  private static async fromBytes(secret: Uint8Array): Promise<PairingAuthenticator> {
    if (secret.byteLength !== 32) throw new Error("Pairing authenticator must contain 256 bits");
    const digestInput = new Uint8Array(pairIdDomain.byteLength + secret.byteLength);
    digestInput.set(pairIdDomain);
    digestInput.set(secret, pairIdDomain.byteLength);
    const pairId = Buffer.from(await cryptoApi.subtle.digest("SHA-256", digestInput)).toString("base64url");
    const encodedSecret = Buffer.from(secret).toString("base64url");
    const key = await cryptoApi.subtle.importKey(
      "raw",
      secret.slice().buffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    secret.fill(0);
    digestInput.fill(0);
    return new PairingAuthenticator(pairId, encodedSecret, key);
  }
}

export function generatePairingCode(): string {
  const random = cryptoApi.getRandomValues(new Uint8Array(pairingCodeLength));
  return [...random].map((byte) => codeAlphabet[byte & 31]).join("");
}

export function normalizePairingCode(value: string): string {
  const code = value.toUpperCase().replace(/[^A-Z0-9]/gu, "");
  if (code.length !== pairingCodeLength || [...code].some((character) => !codeAlphabet.includes(character))) {
    throw new Error("Pairing codes contain eight characters");
  }
  return code;
}

export function formatPairingCode(code: string): string {
  const normalized = normalizePairingCode(code);
  return normalized.match(/.{1,4}/gu)?.join("-") ?? normalized;
}

function pairingTranscript(
  pairId: string,
  role: "bridge" | "watch",
  bridgePublicKey: string,
  watchPublicKey: string,
): string {
  return `agentic-wear-pair-v2\n${pairId}\n${role}\n${bridgePublicKey}\n${watchPublicKey}`;
}
