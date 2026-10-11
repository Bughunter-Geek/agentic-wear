// Uses esbuild already supplied by the locked Vite/Vitest dependency tree.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const bridge = fileURLToPath(new URL("../", import.meta.url));
await build({ entryPoints: [`${bridge}src/desktop-cloud-adapter.ts`],
  outfile: `${bridge}dist/desktop-cloud-adapter.cjs`, bundle: true, format: "cjs",
  platform: "node", target: "node22", minify: true, legalComments: "inline" });
