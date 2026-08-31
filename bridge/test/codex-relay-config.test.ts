import { describe, expect, it } from "vitest";
import {
  relayConfigBlock,
  removeCodexRelayConfig,
  upsertCodexRelayConfig,
} from "../src/codex-relay-config.js";

const values = {
  nodePath: "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node",
  scriptPath: "/tmp/Agentic Wear/bridge/dist/codex-app-tools-relay.js",
  socketPath: "/tmp/agentic-wear.sock",
};

describe("Codex relay configuration", () => {
  it("adds an isolated MCP relay without changing existing settings", () => {
    const existing = 'model = "gpt-5.6-sol"\n\n[mcp_servers.existing]\ncommand = "keep-me"\n';
    const configured = upsertCodexRelayConfig(existing, values);

    expect(configured).toContain(existing.trimEnd());
    expect(configured).toContain("[mcp_servers.agentic_wear_relay]");
    expect(configured).toContain('env_vars = ["CODEX_APP_TOOLS_PIPE_PATH"]');
    expect(configured).toContain('args = ["/tmp/Agentic Wear/bridge/dist/codex-app-tools-relay.js"]');
  });

  it("updates only its managed block and can remove it cleanly", () => {
    const original = 'model = "gpt-5.6-sol"\n';
    const first = upsertCodexRelayConfig(original, values);
    const second = upsertCodexRelayConfig(first, { ...values, socketPath: "/tmp/new.sock" });

    expect(second.match(/BEGIN AGENTIC WEAR CODEX APP RELAY/gu)).toHaveLength(1);
    expect(second).toContain('AGENTIC_WEAR_CODEX_RELAY_SOCKET = "/tmp/new.sock"');
    expect(removeCodexRelayConfig(second)).toBe(original);
  });

  it("refuses to overwrite an unmanaged server with the same name", () => {
    expect(() => upsertCodexRelayConfig(
      "[mcp_servers.agentic_wear_relay]\ncommand = \"custom\"\n",
      values,
    )).toThrow(/outside the managed block/u);
  });

  it("quotes relay paths as TOML strings", () => {
    expect(relayConfigBlock({ ...values, socketPath: '/tmp/a"b.sock' }))
      .toContain('AGENTIC_WEAR_CODEX_RELAY_SOCKET = "/tmp/a\\\"b.sock"');
  });
});
