import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("built bridge distribution", () => {
  it("does not ship the obsolete restart-Codex foreign-session guidance", async () => {
    const distribution = await readFile(new URL("../dist/bridge-service.js", import.meta.url), "utf8");

    expect(distribution).toContain("Agentic Wear did not queue or send your prompt");
    expect(distribution).not.toContain("Update and restart Codex");
  });

  it("uses the shared App Server daemon", async () => {
    const distribution = await readFile(new URL("../dist/bridge-service.js", import.meta.url), "utf8");

    expect(distribution).toContain('this.appServer.connect("daemon")');
    expect(distribution).not.toContain('this.appServer.connect("stdio")');
  });
});
