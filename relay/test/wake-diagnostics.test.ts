import { afterEach, describe, expect, it, vi } from "vitest";
import { acknowledgeStoredEnvelope } from "../src/index";
import { WakeFailure, wakeWatch } from "../src/fcm";

async function testEnv(): Promise<Env> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----`;
  return { FIREBASE_PROJECT_ID: "diag-project", FIREBASE_CLIENT_EMAIL: "diag@example.invalid", FIREBASE_PRIVATE_KEY: pem } as unknown as Env;
}

const TOKEN_OK = JSON.stringify({ access_token: "t".repeat(40) });
const json = (body: unknown, status: number) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

async function failureOf(fetchImpl: (url: string) => Promise<Response>, env?: Env): Promise<WakeFailure> {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => fetchImpl(String(input))));
  try {
    await wakeWatch(env ?? await testEnv(), "installation-secret", "pair-secret", { a: 1 });
  } catch (error) {
    expect(error).toBeInstanceOf(WakeFailure);
    return error as WakeFailure;
  }
  throw new Error("expected failure");
}

const fcmFails = (response: () => Response) => (url: string) =>
  Promise.resolve(url.includes("oauth2") ? json(TOKEN_OK, 200) : response());

afterEach(() => { vi.unstubAllGlobals(); });

describe("wake failure diagnostics", () => {
  it("classifies an OAuth rejection and never logs its description", async () => {
    const failure = await failureOf(() => Promise.resolve(json({ error: "invalid_grant", error_description: "secret detail" }, 400)));
    expect(failure).toMatchObject({ stage: "oauth", httpStatus: 400, fcmErrorCode: "invalid_grant" });
    expect(failure.diagnostics).toEqual({ envelopeAttached: true, envelopeChars: 7 });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const pending: Promise<unknown>[] = [];
      acknowledgeStoredEnvelope(true, { waitUntil: (p) => { pending.push(p); } }, async () => { throw failure; });
      await Promise.all(pending);
      const record = JSON.parse(String(errorLog.mock.calls[0]?.[0]));
      expect(record).toMatchObject({ success: 0, stage: "oauth", httpStatus: 400, fcmErrorCode: "invalid_grant", envelopeAttached: 1, envelopeChars: 7 });
      const text = JSON.stringify(errorLog.mock.calls);
      for (const secret of ["secret detail", "installation-secret", "pair-secret", "diag-project", "diag@example.invalid"]) expect(text).not.toContain(secret);
    } finally { errorLog.mockRestore(); }
  });

  it("extracts the FCM error code from details", async () => {
    const body = { error: { code: 404, status: "NOT_FOUND", message: "secret", details: [
      { "@type": "type.googleapis.com/google.rpc.Other", errorCode: "WRONG" },
      { "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } };
    const failure = await failureOf(fcmFails(() => json(body, 404)));
    expect(failure).toMatchObject({ stage: "fcm", httpStatus: 404, fcmErrorCode: "UNREGISTERED" });
    expect(failure.message).not.toContain("secret");
  });

  it("falls back to error.status", async () => {
    const failure = await failureOf(fcmFails(() => json({ error: { code: 403, status: "PERMISSION_DENIED", message: "x" } }, 403)));
    expect(failure).toMatchObject({ stage: "fcm", httpStatus: 403, fcmErrorCode: "PERMISSION_DENIED" });
  });

  it("yields a null code for junk or non-conforming bodies", async () => {
    expect(await failureOf(fcmFails(() => json("<html>nope</html>", 500)))).toMatchObject({ stage: "fcm", httpStatus: 500, fcmErrorCode: null });
    expect(await failureOf(fcmFails(() => json({ error: { status: "lower case!" } }, 400)))).toMatchObject({ httpStatus: 400, fcmErrorCode: null });
    expect(await failureOf(fcmFails(() => json("x".repeat(20_000), 502)))).toMatchObject({ httpStatus: 502, fcmErrorCode: null });
  });

  it("reports network failures with status 0", async () => {
    const failure = await failureOf(() => Promise.reject(new TypeError("connect secret")));
    expect(failure).toMatchObject({ stage: "network", httpStatus: 0, fcmErrorCode: null });
    expect(failure.message).not.toContain("secret");
  });

  it("reports an unusable signing key as an oauth-stage failure", async () => {
    const env = { FIREBASE_PROJECT_ID: "bad-key", FIREBASE_CLIENT_EMAIL: "bad@example.invalid", FIREBASE_PRIVATE_KEY: "not-a-key" } as unknown as Env;
    expect(await failureOf(() => Promise.reject(new Error("unreachable")), env)).toMatchObject({ stage: "oauth", httpStatus: 0, fcmErrorCode: null });
  });
});
