#!/usr/bin/env node
/**
 * App Store Connect screenshot generator.
 *
 * Input is screenshots you took yourself: one folder per platform, named for it
 * (ios/iphone, ipad, tvos), each holding up to ten images. The tool validates
 * them against the platform's canvas, maps them onto the captions in
 * applestore/shots.config.json, and composites each into a marketing image in
 * the app's own visual language.
 *
 * Usage:
 *   npm run shots                    scan ~/Desktop, adopt, compose, verify
 *   npm run shots -- ~/Shots         scan somewhere else
 *   npm run shots -- --dry-run       show the mapping and stop
 *   npm run shots -- --device tv     one platform
 *   npm run shots -- --capture       drive the simulators and shoot every slot
 *   npm run shots -- --capture-only  capture and stop
 *   npm run shots -- --render        re-render from what was already adopted
 *   npm run shots -- --clean         drop captures for slots this import cannot fill
 *   npm run shots -- --verify        compliance gate only
 *   npm run shots -- --list          print the caption plan and exit
 *   npm run shots -- --self-check    assign() correctness only, no files touched
 *
 * A file whose name starts with a shot id claims that slot; the rest fill the
 * remaining slots in the order they were taken.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { DEVICES, compose, setMetrics, wrongOrientation } from "./appstore/compose.mjs";
import { planImport, adopt, assign } from "./appstore/import.mjs";
import { captureShots } from "./appstore/capture.mjs";
import { ensurePlaceholders } from "./appstore/placeholder.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "applestore", "shots.config.json");
const CAPTURE_DIR = path.join(ROOT, "applestore", "captures");
const APP_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8")).expo;
const BUNDLE_ID = APP_JSON.ios.bundleIdentifier;
const SCHEME = APP_JSON.scheme;

/** App Store Connect: 1-10 per device set, PNG or JPEG, no alpha channel. */
const MAX_SHOTS = 10;
/** How far back the scan looks through the input directory. */
const SCAN_LIMIT = 100;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  const next = i >= 0 ? args[i + 1] : null;
  return next && !next.startsWith("-") ? next : null;
};
/** The first bare argument is the directory to scan. */
const scanDir = args.find((a, i) => !a.startsWith("-") && !args[i - 1]?.startsWith("--device") && !args[i - 1]?.startsWith("--only")) || null;

const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) fail(`Missing ${path.relative(ROOT, CONFIG_PATH)}`);
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const only = opt("--only")
    ?.split(",")
    .map((s) => s.trim());
  const deviceFilter = opt("--device")
    ?.split(",")
    .map((s) => s.trim());

  for (const key of Object.keys(config.devices || {})) {
    if (!DEVICES[key]) fail(`Unknown device "${key}" in config. Known: ${Object.keys(DEVICES).join(", ")}`);
  }
  config.shots = config.shots.filter((s) => !only || only.some((o) => s.id.startsWith(o)));
  for (const shot of config.shots) {
    shot.devices = (shot.devices || Object.keys(config.devices)).filter((d) => !deviceFilter || deviceFilter.includes(d));
  }
  for (const key of Object.keys(config.devices)) {
    const n = config.shots.filter((s) => s.devices.includes(key)).length;
    if (n > MAX_SHOTS) fail(`${key} has ${n} shots configured; App Store Connect accepts at most ${MAX_SHOTS}`);
  }
  return config;
}

const capturePath = (deviceKey, id) => path.join(CAPTURE_DIR, deviceKey, `${id}.png`);
const outputPath = (config, deviceKey, id) => path.join(ROOT, config.output, deviceKey, `${id}.png`);

const plan = (config) => Object.keys(config.devices).map((deviceKey) => ({ deviceKey, shots: config.shots.filter((s) => s.devices.includes(deviceKey)) }));

/**
 * Captures adopted before the set went upright are still on disk, so the shape
 * is checked here as well as at import.
 */
async function guardOrientation(config) {
  const wrong = [];
  for (const { deviceKey, shots } of plan(config)) {
    for (const shot of shots) {
      const src = capturePath(deviceKey, shot.id);
      if (!fs.existsSync(src)) continue;
      const why = await wrongOrientation(src, deviceKey);
      if (why) wrong.push(`${deviceKey}/${shot.id}: ${why}`);
    }
  }
  if (wrong.length) fail(`sideways capture(s):\n   ${wrong.join("\n   ")}\n\n  Re-take them upright, or drop them with --clean.`);
}

// ---------- adopt ----------

/**
 * Print the whole mapping before writing it. A wrong order here would otherwise
 * render ten images against the wrong captions without a word.
 */
async function importShots(config) {
  const { dir, results } = await planImport(config, plan(config), scanDir, SCAN_LIMIT);
  console.log(`\n▸ scanning the ${SCAN_LIMIT} newest folders in ${dir}`);

  let missing = 0;
  let reused = 0;
  const clean = flag("--clean");
  for (const r of results) {
    if (!r.shots.length) continue;
    if (!r.folder) {
      console.log(`\n▸ ${r.deviceKey} — no folder found (expected a directory named for ${r.deviceKey})`);
      missing += r.shots.length;
      continue;
    }
    const [w, h] = DEVICES[r.deviceKey].canvas;
    console.log(`\n▸ ${r.deviceKey} — ${r.folder.name}/  (canvas ${w}x${h})`);
    if (r.folder.ambiguous) console.log(`   ! name matches ${r.folder.ambiguous.join(" and ")}; read as ${r.deviceKey}`);

    for (const { shot, file } of r.assignments) {
      if (!file) {
        // A capture from an earlier run still composes under this caption. Say so, or drop
        // it on --clean; silently reporting it skipped is what shipped the wrong image.
        const stale = capturePath(r.deviceKey, shot.id);
        if (fs.existsSync(stale)) {
          if (clean) {
            fs.unlinkSync(stale);
            console.log(`   ✗ ${shot.id.padEnd(20)} no image left; removed the capture on disk`);
            missing++;
          } else {
            console.log(`   · ${shot.id.padEnd(20)} no image left; reusing the capture on disk`);
            reused++;
          }
          continue;
        }
        console.log(`   ✗ ${shot.id.padEnd(20)} no image left to assign`);
        missing++;
        continue;
      }
      console.log(`   ${file.exact ? "✓" : "⚠"} ${shot.id.padEnd(20)} ${file.name}  (${file.exact ? "native" : `${file.width}x${file.height}, scaled`})`);
    }
    for (const f of r.duplicates) console.log(`   ✗ duplicate          ${f.name} — ${f.shotId} is already claimed; nothing else will take it`);
    for (const f of r.surplus) console.log(`   · unused             ${f.name}`);
    for (const f of r.rejected) console.log(`   ✗ rejected           ${f.name} — ${f.why}`);
  }

  if (flag("--dry-run")) {
    console.log("\n· dry run, nothing adopted\n");
    return null;
  }
  const adopted = adopt(results, CAPTURE_DIR);
  console.log(`\n✓ adopted ${adopted} image(s)`);
  if (reused) console.log(`  ${reused} caption(s) reuse the capture already on disk (--clean drops them instead)`);
  if (missing) console.log(`  ${missing} caption(s) have no image and will be skipped`);
  return adopted;
}

// ---------- compose ----------

async function composeAll(config) {
  for (const { deviceKey, shots } of plan(config)) {
    if (!shots.length) continue;
    const device = DEVICES[deviceKey];
    const [w, h] = device.canvas;
    // One size for the whole device set, so the panel lands on the same pixel.
    const shared = setMetrics(device, shots);

    for (const [index, shot] of shots.entries()) {
      const src = capturePath(deviceKey, shot.id);
      if (!fs.existsSync(src)) continue;
      const out = outputPath(config, deviceKey, shot.id);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const info = await compose(device, shot, src, out, shared, { index, count: shots.length, field: opt("--field") });
      console.log(`   ${deviceKey}/${shot.id} → ${path.relative(ROOT, out)}  ${w}x${h}  caption ${info.captionSize.toFixed(0)}px`);
    }
  }
}

// ---------- compliance ----------

async function verify(config) {
  let failures = 0;
  for (const { deviceKey, shots } of plan(config)) {
    if (!shots.length) continue;
    const present = shots.map((s) => outputPath(config, deviceKey, s.id)).filter((f) => fs.existsSync(f));
    const [w, h] = DEVICES[deviceKey].canvas;
    console.log(`\n▸ ${deviceKey} — ${present.length} image(s), required ${w}x${h}`);
    if (!present.length) console.log("   · nothing generated yet");

    for (const file of present) {
      const meta = await sharp(file).metadata();
      const problems = [];
      if (meta.width !== w || meta.height !== h) problems.push(`is ${meta.width}x${meta.height}, wanted ${w}x${h}`);
      if (meta.hasAlpha) problems.push("has an alpha channel (App Store Connect rejects transparency)");
      if (!["png", "jpeg"].includes(meta.format)) problems.push(`format ${meta.format}`);
      const label = path.basename(file);
      if (problems.length) {
        console.log(`   ✗ ${label}: ${problems.join("; ")}`);
        failures++;
      } else {
        console.log(`   ✓ ${label}  ${meta.width}x${meta.height} ${meta.format} ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
      }
    }
  }
  return failures;
}

/**
 * The store's tile corners, read from apps.apple.com's stylesheet: the 6.9" iPhone
 * tile is `border-radius: 12.8% / 5.7%`, every other device takes its 20px default.
 */
const TILE_RADIUS = {
  iphone: (w, h) => [w * 0.128, h * 0.057],
  ipad: () => [20, 20],
  tv: () => [20, 20],
};

/** One montage per platform, so the set can be judged as a row the way the store shows it. */
async function contactSheet(config) {
  for (const { deviceKey, shots } of plan(config)) {
    const files = shots.map((s) => outputPath(config, deviceKey, s.id)).filter((f) => fs.existsSync(f));
    if (!files.length) continue;

    const [pw, ph] = DEVICES[deviceKey].canvas;
    const tileW = 420;
    const tileH = Math.round((ph / pw) * tileW);
    const gap = 24;
    const [rx, ry] = TILE_RADIUS[deviceKey](tileW, tileH);
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${tileH}"><rect width="${tileW}" height="${tileH}" rx="${rx}" ry="${ry}" fill="#fff"/></svg>`);
    const tiles = await Promise.all(
      files.map((file) =>
        sharp(file)
          .resize(tileW, tileH)
          .composite([{ input: mask, blend: "dest-in" }])
          .png()
          .toBuffer(),
      ),
    );

    let left = gap;
    const placed = tiles.map((buffer) => {
      const at = { input: buffer, left, top: gap };
      left += tileW + gap;
      return at;
    });
    const out = path.join(ROOT, config.output, `contact-sheet-${deviceKey}.png`);
    await sharp({ create: { width: left, height: tileH + gap * 2, channels: 3, background: "#FFFFFF" } })
      .composite(placed)
      .png()
      .toFile(out);
    console.log(`   ${deviceKey} → ${path.relative(ROOT, out)}`);
  }
}

// ---------- self check ----------

/**
 * Exercises assign() against the cases that decide which caption an image ships under.
 * Runs in CI: jest's testMatch cannot see .mjs, so this follows the same node-run shape
 * as playback-regression's --verify-manifest.
 */
function selfCheck() {
  const shots = [{ id: "01-library" }, { id: "02-grid" }, { id: "03-info" }];
  const file = (name) => ({ name, full: `/tmp/${name}`, mtime: 0 });
  const problems = [];
  const check = (label, ok) => {
    console.log(`${ok ? "✓" : "✗"} ${label}`);
    if (!ok) problems.push(label);
  };

  // The bug this guards: the second file naming a taken shot used to fall through to the
  // fallback pass and fill another caption's slot.
  const dup = assign(shots, [file("01-library.png"), file("01-library-alt.png"), file("shot-c.png")]);
  check("a duplicate claim never fills another caption's slot", dup.byShot.get("02-grid")?.name === "shot-c.png");
  check("a duplicate is reported against the shot it named", dup.duplicates.length === 1 && dup.duplicates[0].shotId === "01-library");
  check("a duplicate is not offered as surplus", !dup.surplus.some((f) => f.name === "01-library-alt.png"));

  const mixed = assign(shots, [file("03-info.png"), file("a.png"), file("b.png")]);
  check("an explicit claim wins its own slot", mixed.byShot.get("03-info")?.name === "03-info.png");
  check("the rest fill the remaining slots in capture order", mixed.byShot.get("01-library")?.name === "a.png" && mixed.byShot.get("02-grid")?.name === "b.png");

  const over = assign(shots, [file("a.png"), file("b.png"), file("c.png"), file("d.png")]);
  check("files past the last slot are surplus", over.surplus.length === 1 && over.surplus[0].name === "d.png");

  const numbered = assign(shots, [file("02 grid.png")]);
  check("a bare leading number claims its shot", numbered.byShot.get("02-grid")?.name === "02 grid.png");

  console.log(problems.length ? `\n${problems.length} problem(s)` : "\nassign() holds every caption to its own image");
  return problems.length === 0;
}

// ---------- main ----------

async function main() {
  if (flag("--self-check")) {
    if (!selfCheck()) process.exit(1);
    return;
  }

  const config = loadConfig();

  if (flag("--list")) {
    for (const { deviceKey, shots } of plan(config)) {
      if (!shots.length) continue;
      console.log(`\n${deviceKey}  ${DEVICES[deviceKey].canvas.join("x")}`);
      shots.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s.id.padEnd(20)} ${JSON.stringify(s.title)}`));
    }
    console.log();
    return;
  }

  if (flag("--verify")) {
    const failures = await verify(config);
    console.log();
    if (failures) fail(`${failures} compliance problem(s)`);
    console.log("✓ every generated image is App Store Connect compliant\n");
    return;
  }

  if (flag("--capture") || flag("--capture-only")) {
    console.log("\n▸ capturing");
    const shot = await captureShots(config, plan(config), { root: ROOT, captureDir: CAPTURE_DIR, bundleId: BUNDLE_ID, scheme: SCHEME, envFile: opt("--env") });
    console.log(`\n✓ captured ${shot} screen(s)`);
    if (flag("--capture-only")) return;
  } else if (!flag("--render")) {
    const adopted = await importShots(config);
    if (adopted === null) return;
  }

  console.log("\n▸ placeholders");
  const stand = await ensurePlaceholders(plan(config), CAPTURE_DIR, (key) => ({ canvas: DEVICES[key].canvas, simulator: DEVICES[key].simulator }));
  for (const key of stand.written) console.log(`   + ${key}`);
  console.log(`   ${stand.real} captured, ${stand.pending.length} pending${stand.written.length ? ` (${stand.written.length} new)` : ""}`);

  await guardOrientation(config);

  console.log("\n▸ composing");
  await composeAll(config);

  console.log("\n▸ contact sheets");
  await contactSheet(config);

  console.log("\n▸ verifying");
  const failures = await verify(config);
  console.log();
  if (failures) fail(`${failures} compliance problem(s)`);
  if (stand.pending.length) {
    console.log(`✓ done, ${stand.pending.length} slot(s) still showing CAPTURE PENDING:`);
    for (const key of stand.pending) console.log(`   · ${key}`);
    console.log();
  } else {
    console.log("✓ done, every configured slot has a real capture\n");
  }
}

main().catch((e) => fail(e.message));
