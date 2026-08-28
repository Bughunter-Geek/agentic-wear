import type { CryptoBox } from "./crypto-box.js";
import { ReplayGuard } from "./replay-guard.js";
import { watchPayloadSchema, type WatchPayload, type WireEnvelope } from "./schemas.js";

export async function processAuthenticatedEnvelope(
  envelope: WireEnvelope,
  crypto: Pick<CryptoBox, "decrypt">,
  replayGuard: ReplayGuard,
  handle: (payload: WatchPayload) => Promise<void>,
): Promise<boolean> {
  const payload = watchPayloadSchema.parse(await crypto.decrypt(envelope));
  if (!(await replayGuard.claim(envelope.messageId, envelope.sentAt))) return false;
  await handle(payload);
  return true;
}
