import { describe, expect, it } from "vitest";
import {
  formatPairingCode,
  generatePairingCode,
  normalizePairingCode,
  PairingAuthenticator,
} from "../src/pairing-auth.js";

const bridgePublicKey = "bridge-public-key";
const watchPublicKey = "watch-public-key";

describe("PairingAuthenticator", () => {
  it("matches the shared bridge/watch authentication vector", async () => {
    const authenticator = await PairingAuthenticator.fromCode("ABCD-2345");
    expect(authenticator.pairId).toBe("enAbNInJ8okG3POKtCwnI0kuURH9viQTZlCPpcldao4");
    expect(await authenticator.createProof("watch", bridgePublicKey, watchPublicKey))
      .toBe("aXjRSCkiEwYziC4YxKbGTPV33nTzES67NNBxcHqn-wo");
    expect(await authenticator.createProof("bridge", bridgePublicKey, watchPublicKey))
      .toBe("v--ZPVadRpXfaAsXsoHdnWy0tzbBMHApKFCrAMT5vow");
  });

  it("binds proofs to the endpoint role and both public keys", async () => {
    const authenticator = await PairingAuthenticator.fromCode("ABCD2345");
    const proof = await authenticator.createProof("watch", bridgePublicKey, watchPublicKey);
    expect(await authenticator.verifyProof("watch", bridgePublicKey, watchPublicKey, proof)).toBe(true);
    expect(await authenticator.verifyProof("bridge", bridgePublicKey, watchPublicKey, proof)).toBe(false);
    expect(await authenticator.verifyProof("watch", "changed-bridge-key", watchPublicKey, proof)).toBe(false);
    expect(await authenticator.verifyProof("watch", bridgePublicKey, "changed-watch-key", proof)).toBe(false);
    expect(await authenticator.verifyProof("watch", bridgePublicKey, watchPublicKey, "A".repeat(43))).toBe(false);
  });

  it("generates and formats unambiguous eight-character codes", () => {
    for (let index = 0; index < 32; index += 1) {
      const code = generatePairingCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/u);
      expect(normalizePairingCode(formatPairingCode(code))).toBe(code);
    }
  });
});
