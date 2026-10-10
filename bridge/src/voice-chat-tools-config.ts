import { fileURLToPath } from "node:url";
import { configPath } from "./config.js";

/** Call-scoped MCP configuration. No persistent Codex config or policy changes. */
export function voiceChatToolsConfig(sourceThreadId: string): Record<string, unknown> {
  return {
    "mcp_servers.agentic_wear_voice_chats": {
      command: process.execPath,
      args: [fileURLToPath(new URL("./voice-chat-tools-mcp.js", import.meta.url)),
        "--source-thread", sourceThreadId, "--ledger", `${configPath()}.voice-messages`],
      enabled: true,
      env: {
        ...(process.env.AGENTIC_WEAR_CODEX_PATH ? { AGENTIC_WEAR_CODEX_PATH: process.env.AGENTIC_WEAR_CODEX_PATH } : {}),
        ...(process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {}),
      },
      startup_timeout_sec: 20,
      tool_timeout_sec: 30,
    },
  };
}

export function voiceChatToolInstructions(available: boolean): string {
  return available
    ? "For a user-requested message to another existing local Codex chat, use the Agentic Wear MCP tools find_local_codex_chats, prepare_local_codex_message, and send_local_codex_message. Resolve the exact destination, preserve the exact message, and obtain explicit user intent. Use the persistent token and report the acknowledged queue status accurately. Never use desktop clicks, take writer ownership, create a replacement chat, or claim execution from queue acceptance. These tools do not provide cloud or dot access."
    : "Cross-chat Agentic Wear tools are unavailable in this already-loaded runtime. Ordinary voice remains available. If the user asks to send to another chat, state this route is unavailable here and ask them to use a fresh local voice task. Do not attempt desktop clicks, claim a message was sent, or restart another session.";
}
