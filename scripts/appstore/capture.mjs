/**
 * Screenshot capture. Every screen is reached by deep link and every id is resolved from
 * the server by name, so a run either produces the configured shot or fails saying why.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEVICES } from "./compose.mjs";
import { assertAppOnServer, itemId, libraryId, loadEnv, waitForPlaying } from "./jellyfin.mjs";
import * as sim from "./simctl.mjs";

const TOKEN = /\{(library|item):([^}]+)\}/g;

/** Name-to-id lookups, memoised so a repeated library costs one request. */
function makeResolver(env) {
  const cache = new Map();
  return async function resolve(value) {
    const tokens = [...String(value).matchAll(TOKEN)];
    let out = String(value);
    for (const [whole, kind, name] of tokens) {
      const key = `${kind}:${name}`;
      if (!cache.has(key)) cache.set(key, kind === "library" ? await libraryId(env, name) : await itemId(env, name));
      out = out.replace(whole, cache.get(key));
    }
    return out;
  };
}

function needsServer(shots) {
  return shots.some((s) => new RegExp(TOKEN.source).test(JSON.stringify(s.capture ?? {})));
}

async function deepLink(shot, resolve) {
  const spec = shot.capture;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(spec.params ?? {})) query.append(k, await resolve(v));
  const pathPart = await resolve(spec.path);
  return `tomotv://${pathPart}${[...query].length ? `?${query}` : ""}`;
}

export async function captureShots(config, plan, { root, captureDir, bundleId, scheme, metroUrl = "http://localhost:8081", envFile, log = console.log }) {
  const wanted = plan.filter((p) => p.shots.length);
  const missingSpec = wanted.flatMap((p) => p.shots.filter((s) => !s.capture?.path).map((s) => s.id));
  if (missingSpec.length) throw new Error(`No capture.path for: ${[...new Set(missingSpec)].join(", ")}`);

  // Only id resolution truly requires the server, but whenever it is configured the app
  // is held to it: a shot of the wrong library is worse than a failed run.
  const server = wanted.some((p) => needsServer(p.shots));
  const env = loadEnv(root, envFile);
  if (server && !env) {
    throw new Error("Capture needs JELLYFIN_URL and JELLYFIN_API_KEY (looked for .env.appstore, then .env.playback-test).\n   They must point at the server the simulators are signed in to.");
  }
  if (env) log(`   server ${env.url}  (${env.file})`);
  const resolve = env ? makeResolver(env) : async (v) => v;

  const dev = await sim.metroUp(metroUrl);
  log(`   ${dev ? `dev build via Metro ${metroUrl}` : "release build (no Metro)"}`);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-shots-"));
  let captured = 0;

  for (const { deviceKey, shots } of wanted) {
    const profile = DEVICES[deviceKey];
    log(`\n▸ ${deviceKey} — ${profile.simulator}`);
    const device = await sim.ensureBooted(await sim.resolveDevice(profile.simulator));
    await sim.assertInstalled(device.udid, bundleId);
    if (deviceKey !== "tv") await sim.cleanStatusBar(device.udid).catch(() => log("   ! status bar override refused"));

    await sim.relaunch(device.udid, bundleId, dev ? { scheme, metroUrl } : {});
    // A dev build fetches its bundle from Metro before it draws anything.
    await sim.sleep(12000);

    if (env) await assertAppOnServer(env, { family: deviceKey === "tv" ? "Apple TV" : "iOS" });

    // Two routes that must render differently. A build still on its launch screen settles
    // to the same frame for both. Jellyfin keeps reporting the pre-relaunch session for a
    // while, so being "on the server" does not mean the UI is up; this is what proves it.
    const probe = path.join(scratch, `${deviceKey}-probe.png`);
    let rendering = false;
    for (let attempt = 1; attempt <= 5 && !rendering; attempt++) {
      await sim.openUrl(device.udid, "tomotv:///settings");
      const a = await sim.settle(device.udid, probe, { stable: 3, gap: 700, delayMs: 1500 });
      await sim.openUrl(device.udid, "tomotv:///");
      const b = await sim.settle(device.udid, probe, { stable: 3, gap: 700, delayMs: 1500 });
      rendering = a !== b;
      if (!rendering) await sim.sleep(4000);
    }
    if (!rendering) throw new Error(`${deviceKey}: /settings and / still render the same frame, so the app never came up.`);
    log(`   app renders routes`);

    const outDir = path.join(captureDir, deviceKey);
    fs.mkdirSync(outDir, { recursive: true });

    for (const shot of shots) {
      const url = await deepLink(shot, resolve);
      const frame = path.join(scratch, `${deviceKey}-${shot.id}.png`);
      const before = sim.hashOf(await sim.screenshot(device.udid, frame));

      await sim.openUrl(device.udid, url);
      if (shot.capture.ready === "session") {
        const id = new URL(url).searchParams.get("videoId");
        await waitForPlaying(env, id);
        await sim.screenshot(device.udid, frame);
      } else {
        await sim.settle(device.udid, frame, { stable: 3, delayMs: 1200 });
      }

      // A route the app already rests on repaints to the same pixels, so an unchanged frame
      // is only worth saying out loud. Resting on the launch screen is not.
      if (deviceKey !== "tv" && (await sim.looksUpsideDown(frame))) {
        throw new Error(`${deviceKey}/${shot.id}: the frame is upside down. Set that simulator to Portrait (Device > Orientation > Portrait) and re-run.`);
      }
      if (sim.hashOf(frame) === before) log(`   · ${shot.id} unchanged from the previous screen`);
      fs.copyFileSync(frame, path.join(outDir, `${shot.id}.png`));
      captured++;
      log(`   ✓ ${shot.id}  ${url}`);
    }
  }

  fs.rmSync(scratch, { recursive: true, force: true });
  return captured;
}
