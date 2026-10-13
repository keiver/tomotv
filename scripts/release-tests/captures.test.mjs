import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { generatedShots, validateCaptures } from "../appstore/captures.mjs";
import { hashFile, saveManifest } from "../appstore/cache.mjs";
import { compose, DEVICES, setMetrics } from "../appstore/compose.mjs";
import { stampStatusBar } from "../appstore/statusbar.mjs";

const config = { devices: { mac: {} }, locales: { en: {}, de: {} }, shots: [{ id: "01-library", devices: ["mac"], title: "Your library.", sub: "On your Mac." }] };
async function fixture(t, width = 160, height = 100) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-captures-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const capture = path.join(root, "applestore/captures/mac/01-library.png");
  fs.mkdirSync(path.dirname(capture), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: "#101820" } })
    .png()
    .toFile(capture);
  return { root, capture };
}
test("Mac captures use English fallback and leave the original status bar alone", async (t) => {
  const { root, capture } = await fixture(t);
  await validateCaptures(root, config);
  assert.equal((await stampStatusBar(capture, "mac")).input, capture);
});
test("missing and portrait Mac captures fail before release", async (t) => {
  const { root, capture } = await fixture(t, 90, 160);
  await assert.rejects(validateCaptures(root, config), /landscape/);
  fs.unlinkSync(capture);
  await assert.rejects(validateCaptures(root, config), /missing capture/);
});
test("placeholder checksum uses the compositor's raw SHA256 convention", async (t) => {
  const { root, capture } = await fixture(t);
  fs.writeFileSync(path.join(root, "applestore/captures/.placeholders.json"), JSON.stringify({ "mac/01-library": createHash("sha256").update(fs.readFileSync(capture)).digest("hex") }));
  await assert.rejects(validateCaptures(root, config), /CAPTURE PENDING/);
});
test("a Mac render has the App Store size and stale captures cannot upload", async (t) => {
  const { root, capture } = await fixture(t);
  const dir = path.join(root, "applestore/generated/en");
  const output = path.join(dir, "mac/01-library.png");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await compose(DEVICES.mac, config.shots[0], capture, output, setMetrics(DEVICES.mac, config.shots), path.resolve("applestore/backgrounds/green.svg"));
  saveManifest(dir, { "mac/01-library": { sha: hashFile(output), capture: path.relative(root, capture), captureSha: hashFile(capture) } });
  assert.deepEqual(await generatedShots(root, config, "en", "mac"), [output]);
  // Unconfigured leftovers never become additional store screenshots.
  fs.copyFileSync(output, path.join(path.dirname(output), "old-shot.png"));
  assert.equal((await generatedShots(root, config, "en", "mac")).length, 1);
  await sharp({ create: { width: 320, height: 200, channels: 3, background: "#282830" } })
    .png()
    .toFile(capture);
  await assert.rejects(generatedShots(root, config, "en", "mac"), /stale render/);
});
