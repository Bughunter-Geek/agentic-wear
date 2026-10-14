import assert from "node:assert/strict";
import { test } from "node:test";
import { validateReceiverPackage } from "../scripts/check-receiver-package.mjs";

function fixture() {
  return new Map([
    ["manifest.json", JSON.stringify({ permissions: ["storage"], action: { default_popup: "popup.html" }, background: { service_worker: "worker.js" }, content_scripts: [{ js: ["content.js", "voice-controller.js"] }] })],
    ["popup.html", '<script src="popup.js"></script>'],
    ...["popup.js", "content.js", "voice-controller.js", "worker.js"].map(path => [path, "let dotSelection = null;"]),
  ]);
}
const reader = files => path => { if (!files.has(path)) throw new Error("missing"); return files.get(path); };

test("complete receiver without a default passes", () => validateReceiverPackage(reader(fixture())));
test("stale receiver with a literal Dot default fails without revealing it", () => {
  const files = fixture(), synthetic = "a".repeat(32);
  files.set("content.js", `const namespace = '${synthetic}';`);
  assert.throws(() => validateReceiverPackage(reader(files)), error => /Hardcoded identifier/.test(error.message) && !error.message.includes(synthetic));
});
test("both popup files must be present and nonempty", () => {
  for (const path of ["popup.html", "popup.js"]) {
    const files = fixture(); files.delete(path);
    assert.throws(() => validateReceiverPackage(reader(files)), /Missing receiver file/);
    files.set(path, " ");
    assert.throws(() => validateReceiverPackage(reader(files)), /Empty receiver file/);
  }
});
test("popup declaration, script and selection storage permission are required", () => {
  for (const mutate of [m => { delete m.action.default_popup; }, m => { m.permissions = []; }]) {
    const files = fixture(), manifest = JSON.parse(files.get("manifest.json")); mutate(manifest);
    files.set("manifest.json", JSON.stringify(manifest));
    assert.throws(() => validateReceiverPackage(reader(files)), /Receiver/);
  }
  const files = fixture(); files.set("popup.html", "<p>No selection script</p>");
  assert.throws(() => validateReceiverPackage(reader(files)), /popup.js/);
});
test("manifest-referenced transport scripts cannot be omitted", () => {
  const files = fixture(); files.delete("worker.js");
  assert.throws(() => validateReceiverPackage(reader(files)), /Missing receiver file: worker.js/);
});
