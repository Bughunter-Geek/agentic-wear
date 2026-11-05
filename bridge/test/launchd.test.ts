import { describe, expect, it } from "vitest";
import { launchAgentPathVariable, plist } from "../src/launchd.js";

describe("LaunchAgent property list", () => {
  const xml = plist(
    "/opt/homebrew/Cellar/node/22.0.0/bin/node",
    "/Users/someone/agentic-wear/bridge/dist/cli.js",
    "/Users/someone/agentic-wear",
    "/Users/someone/.npm-global/bin/codex",
    "/Users/someone/Library/Logs/AgenticWear",
  );

  it("puts the node and codex directories on PATH so env-node shebangs work under launchd", () => {
    const path = launchAgentPathVariable("/opt/homebrew/Cellar/node/22.0.0/bin/node", "/Users/someone/.npm-global/bin/codex");
    const entries = path.split(":");
    expect(entries[0]).toBe("/opt/homebrew/Cellar/node/22.0.0/bin");
    expect(entries).toContain("/Users/someone/.npm-global/bin");
    expect(entries).toContain("/usr/bin");
    expect(new Set(entries).size).toBe(entries.length);
    expect(xml).toContain(`<key>PATH</key>\n    <string>${path}</string>`);
  });

  it("restarts on crash, starts at login, logs to ~/Library/Logs and points at the checkout's .env.local", () => {
    expect(xml).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/u);
    expect(xml).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/u);
    expect(xml).toContain("<string>/Users/someone/Library/Logs/AgenticWear/bridge.log</string>");
    expect(xml).toContain("<string>/Users/someone/Library/Logs/AgenticWear/bridge.err.log</string>");
    expect(xml).toContain("<string>/Users/someone/agentic-wear/.env.local</string>");
  });

  it("escapes XML-significant characters in paths", () => {
    const escaped = plist("/n&<>/node", "/c/cli.js", "/r", "/x'\"/codex", "/l");
    expect(escaped).toContain("/n&amp;&lt;&gt;/node");
    expect(escaped).toContain("/x&apos;&quot;/codex");
    expect(escaped).not.toContain("/n&<");
  });
});
