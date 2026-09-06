import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { INVALID_RELAY_MESSAGE_REASON, waitForRelayReconnect } from "../src/relay-socket-policy.js";

describe("relay socket policy", () => {
  it("uses a public close reason that fits the WebSocket byte limit", () => {
    assert.ok(Buffer.byteLength(INVALID_RELAY_MESSAGE_REASON, "utf8") <= 123);
    assert.equal(INVALID_RELAY_MESSAGE_REASON, "Invalid relay message");
  });

  it("does not wait or throw when shutdown already happened", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Stopped"));
    assert.equal(await waitForRelayReconnect(60_000, controller.signal), false);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });

  it("stops a pending reconnect without turning shutdown into an error", async () => {
    const controller = new AbortController();
    const waiting = waitForRelayReconnect(60_000, controller.signal);
    controller.abort(new Error("Stopped"));
    assert.equal(await waiting, false);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });

  it("removes abort listeners after successful waits", async () => {
    const controller = new AbortController();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      assert.equal(await waitForRelayReconnect(1, controller.signal), true);
    }
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
});
