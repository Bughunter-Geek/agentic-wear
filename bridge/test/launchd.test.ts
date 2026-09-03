import { describe, expect, it } from "vitest";
import {
  generateLaunchAgentPlist,
  parseLaunchAgentPlist,
} from "../src/launchd.js";

describe("launchd configuration", () => {
  it("generates valid plist XML with canonical repo and cli paths", () => {
    const nodePath = "/opt/homebrew/bin/node";
    const repoRoot = "/Users/bughunter/codex-workspace/Codex-WearOS";
    const cliPath = `${repoRoot}/bridge/dist/cli.js`;
    const codexPath = "/Applications/ChatGPT.app/Contents/Resources/codex";

    const xml = generateLaunchAgentPlist(nodePath, cliPath, repoRoot, codexPath);

    expect(xml).toContain("<string>io.github.sirbughunter.agenticwear.bridge</string>");
    expect(xml).toContain(`<string>${nodePath}</string>`);
    expect(xml).toContain(`<string>${cliPath}</string>`);
    expect(xml).toContain("<string>start</string>");
    expect(xml).toContain(`<string>${repoRoot}</string>`);
    expect(xml).toContain(`<string>${codexPath}</string>`);

    const parsed = parseLaunchAgentPlist(xml);
    expect(parsed.workingDirectory).toBe(repoRoot);
    expect(parsed.cliPath).toBe(cliPath);
    expect(parsed.nodePath).toBe(nodePath);
    expect(parsed.codexPath).toBe(codexPath);
  });

  it("escapes special characters in plist paths", () => {
    const nodePath = "/opt/homebrew/bin/node";
    const repoRoot = "/Users/bughunter/codex & repo/test<dir>";
    const cliPath = `${repoRoot}/bridge/dist/cli.js`;
    const codexPath = "/Applications/Codex.app";

    const xml = generateLaunchAgentPlist(nodePath, cliPath, repoRoot, codexPath);

    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;dir&gt;");

    const parsed = parseLaunchAgentPlist(xml);
    expect(parsed.workingDirectory).toBe("/Users/bughunter/codex &amp; repo/test&lt;dir&gt;");
  });

  it("detects obsolete worktree paths from older installations", () => {
    const obsoletePlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.github.sirbughunter.agenticwear.bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/Cellar/node/25.2.1/bin/node</string>
    <string>/Users/bughunter/codex-workspace/Codex-WearOS-release-v0.1.9/bridge/dist/cli.js</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/bughunter/codex-workspace/Codex-WearOS-release-v0.1.9</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENTIC_WEAR_CODEX_PATH</key>
    <string>/Applications/ChatGPT.app/Contents/Resources/codex</string>
  </dict>
</dict>
</plist>
`;
    const parsed = parseLaunchAgentPlist(obsoletePlist);
    expect(parsed.workingDirectory).toBe("/Users/bughunter/codex-workspace/Codex-WearOS-release-v0.1.9");
    expect(parsed.cliPath).toBe("/Users/bughunter/codex-workspace/Codex-WearOS-release-v0.1.9/bridge/dist/cli.js");

    const canonicalRoot = "/Users/bughunter/codex-workspace/Codex-WearOS";
    expect(parsed.workingDirectory).not.toBe(canonicalRoot);
  });
});
