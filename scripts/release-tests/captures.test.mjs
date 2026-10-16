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
  saveManifest(dir, { "mac/01-library": { sha: hashFile(output), captures: [{ path: path.relative(root, capture), sha: hashFile(capture) }] } });
  assert.deepEqual(await generatedShots(root, config, "en", "mac"), [output]);
  // Unconfigured leftovers never become additional store screenshots.
  fs.copyFileSync(output, path.join(path.dirname(output), "old-shot.png"));
  assert.equal((await generatedShots(root, config, "en", "mac")).length, 1);
  await sharp({ create: { width: 320, height: 200, channels: 3, background: "#282830" } })
    .png()
    .toFile(capture);
  await assert.rejects(generatedShots(root, config, "en", "mac"), /stale render/);
});

const duoConfig = {
  devices: { duo: { layout: "pair" } },
  locales: { en: {} },
  shots: [
    { id: "01-library", devices: ["duo"], title: "YOUR\nLIBRARY", spec: "movies" },
    { id: "02-player", devices: ["duo"], title: "THE\nPLAYER", spec: "airplay", platforms: { duo: { layout: "inner" } } },
  ],
};
async function duoCapture(root, name, [width, height]) {
  const file = path.join(root, "applestore/captures/duo", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: "#1C1C1E" } })
    .png()
    .toFile(file);
  return file;
}
function duoRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-duo-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("a Duo pair needs both screens, a single-screen layout only its own", async (t) => {
  const root = duoRoot(t);
  await duoCapture(root, "01-library.inner.png", [2853, 2007]);
  await duoCapture(root, "02-player.inner.png", [2853, 2007]);
  await assert.rejects(validateCaptures(root, duoConfig), (e) => /duo\/01-library\.outer: missing capture/.test(e.message) && !/02-player/.test(e.message));
  await duoCapture(root, "01-library.outer.png", [1398, 2034]);
  await validateCaptures(root, duoConfig);
});
test("a Duo capture on its side is refused", async (t) => {
  const root = duoRoot(t);
  await duoCapture(root, "01-library.inner.png", [2853, 2007]);
  await duoCapture(root, "01-library.outer.png", [2034, 1398]);
  await duoCapture(root, "02-player.inner.png", [2853, 2007]);
  await assert.rejects(validateCaptures(root, duoConfig), /duo outer takes portrait only/);
});
test("a Duo pair renders both screens at one scale on the landscape canvas", async (t) => {
  const root = duoRoot(t);
  const inner = await duoCapture(root, "01-library.inner.png", [2853, 2007]);
  const outer = await duoCapture(root, "01-library.outer.png", [1398, 2034]);
  const shot = { ...duoConfig.shots[0], layout: "pair" };
  const out = path.join(root, "pair.png");
  const info = await compose(
    DEVICES.duo,
    shot,
    [
      { mode: "inner", input: inner },
      { mode: "outer", input: outer },
    ],
    out,
    setMetrics(DEVICES.duo, [shot]),
    path.resolve("applestore/backgrounds/green.svg"),
  );
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.width, meta.height, meta.hasAlpha], [2853, 2007, false]);
  const [i, o] = info.panels;
  assert.deepEqual([i.mode, o.mode], ["inner", "outer"]);
  // One scale: canvas pixels per capture pixel match, so the screens keep their real sizes.
  assert.ok(Math.abs(i.screen.width / 2853 - o.screen.width / 1398) < 1e-9);
  assert.ok(i.screen.x + i.screen.width < o.screen.x);
});
test("changing either Duo screen makes its render stale", async (t) => {
  const root = duoRoot(t);
  const config = { ...duoConfig, shots: [duoConfig.shots[0]] };
  const inner = await duoCapture(root, "01-library.inner.png", [2853, 2007]);
  const outer = await duoCapture(root, "01-library.outer.png", [1398, 2034]);
  const dir = path.join(root, "applestore/generated/en");
  const output = path.join(dir, "duo/01-library.png");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const shot = { ...config.shots[0], layout: "pair" };
  await compose(
    DEVICES.duo,
    shot,
    [
      { mode: "inner", input: inner },
      { mode: "outer", input: outer },
    ],
    output,
    setMetrics(DEVICES.duo, [shot]),
    path.resolve("applestore/backgrounds/green.svg"),
  );
  saveManifest(dir, {
    "duo/01-library": {
      sha: hashFile(output),
      captures: [inner, outer].map((file) => ({ path: path.relative(root, file), sha: hashFile(file) })),
    },
  });
  assert.deepEqual(await generatedShots(root, config, "en", "duo"), [output]);
  await duoCapture(root, "01-library.outer.png", [1398, 2034]).then((file) => fs.appendFileSync(file, Buffer.from([0])));
  await assert.rejects(generatedShots(root, config, "en", "duo"), /stale render/);
});
