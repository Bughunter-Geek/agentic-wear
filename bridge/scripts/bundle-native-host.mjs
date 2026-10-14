// Reproducibly bundles ../browser-receiver/native-host.mjs into
// ../browser-receiver/native-host.bundle.mjs.
//
// native-host.mjs imports ../bridge/dist/*.js, so the bridge TypeScript build
// must have run first: `npx tsc -p .` (emits into bridge/dist), then
// `npm run bundle:native-host`.
import { build } from "esbuild";
import { checkReceiverPackage } from "./check-receiver-package.mjs";

checkReceiverPackage();
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../../browser-receiver/native-host.mjs", import.meta.url));
const outfile = fileURLToPath(new URL("../../browser-receiver/native-host.bundle.mjs", import.meta.url));

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: false,
  legalComments: "inline"
});
console.log(`native-host bundle: ${outfile} (${statSync(outfile).size} bytes)`);
