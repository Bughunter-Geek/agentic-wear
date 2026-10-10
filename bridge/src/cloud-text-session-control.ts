import { pathToFileURL } from "node:url";
import { CloudTextSession } from "./cloud-text-session.js";
import { CLOUD_TEXT_TARGET } from "./native-cloud-history.js";
import { waitForCloudTextWork } from "./cloud-text-control-wait.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2] ?? "status";
  const input = process.argv[3] ?? "{}";
  Promise.resolve().then(async () => {
    if (command !== "status" && process.env.CODEX_THREAD_ID !== CLOUD_TEXT_TARGET.controllerThreadId)
      throw new Error("Run this controller from the existing approved controller task; do not override its caller identity");
    if (Buffer.byteLength(input) > 180_000) throw new Error("Controller input exceeds the command bound");
    const session = new CloudTextSession();
    const args = JSON.parse(input) as Record<string, unknown>;
    const result = command === "poll-wait" ? await waitForCloudTextWork(session, args) : await session.control(command, args);
    console.log(JSON.stringify(result));
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Cloud text controller failed");
    process.exitCode = 1;
  });
}
