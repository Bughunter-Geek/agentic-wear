import { setTimeout as delay } from "node:timers/promises";

// RFC 6455 leaves only 123 UTF-8 bytes for the close reason. A fixed public
// message also prevents callback errors from leaking internal details.
export const INVALID_RELAY_MESSAGE_REASON = "Invalid relay message";

/** Returns false on intentional shutdown, without retaining abort listeners. */
export async function waitForRelayReconnect(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  try {
    await delay(milliseconds, undefined, { signal });
    return !signal.aborted;
  } catch (error) {
    if (signal.aborted) return false;
    throw error;
  }
}
