/**
 * Simulator control for screenshot capture. Every screen is reached through the app's
 * own deep links: simctl has no text or key primitive, and no third-party driver is
 * installed, so synthetic input has no place here.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function simctl(args, options = {}) {
  return exec("xcrun", ["simctl", ...args], { timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options });
}

/**
 * The device whose name matches exactly. Names come from DEVICES[key].simulator, which
 * distinguishes "Apple TV 4K (3rd generation)" from the "(at 1080p)" variant that shoots
 * 1920x1080 into a 3840x2160 slot.
 */
export async function resolveDevice(simulatorName) {
  const { stdout } = await simctl(["list", "devices", "-j"]);
  const all = Object.values(JSON.parse(stdout).devices).flat();
  const device = all.find((d) => d.name === simulatorName && d.isAvailable !== false);
  if (!device) {
    const near = all.filter((d) => d.name.includes(simulatorName.split(" ")[0])).map((d) => d.name);
    throw new Error(`No simulator named "${simulatorName}".${near.length ? ` Close matches: ${[...new Set(near)].join(", ")}` : ""}`);
  }
  return device;
}

export async function ensureBooted(device) {
  if (device.state === "Booted") return device;
  await simctl(["boot", device.udid]);
  await simctl(["bootstatus", device.udid], { timeout: 240000 });
  return { ...device, state: "Booted" };
}

export async function assertInstalled(udid, bundleId) {
  await simctl(["get_app_container", udid, bundleId, "app"]).catch(() => {
    throw new Error(`${bundleId} is not installed on ${udid}. Build and install it, then re-run.`);
  });
}

export async function openUrl(udid, url) {
  await simctl(["openurl", udid, url]);
}

/** `-` is not stdout: simctl writes a file with that literal name. Always pass a path. */
export async function screenshot(udid, file) {
  await simctl(["io", udid, "screenshot", "--type=png", "--mask=ignored", file]);
  return file;
}

export function hashOf(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Screenshot until the frame repeats `stable` times, after an optional dwell. The dwell
 * covers the window where openurl has not repainted yet and the frame is still the old
 * screen; the repeats cover a screen caught mid-layout.
 */
export async function settle(udid, file, { before = null, stable = 2, tries = 60, gap = 400, delayMs = 0 } = {}) {
  if (delayMs) await sleep(delayMs);
  let last = null;
  let runs = 0;
  for (let i = 0; i < tries; i++) {
    await screenshot(udid, file);
    const hash = hashOf(file);
    runs = hash === last ? runs + 1 : 1;
    last = hash;
    if (runs >= stable && (before === null || hash !== before)) return hash;
    await sleep(gap);
  }
  throw new Error(`Screen never settled after ${tries} frames (${(tries * gap) / 1000}s).`);
}

/**
 * Whether a frame is upside down. cleanStatusBar sets a charged battery, which draws green
 * at the top right upright and the bottom left flipped. One-sided on purpose: green only at
 * the bottom proves a flip, while finding none proves nothing, so a good frame never fails.
 */
export async function looksUpsideDown(file) {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(file).metadata();
  const bandH = Math.round(meta.height * 0.02);
  const bandW = Math.round(meta.width * 0.28);
  const greens = async (left, top) => {
    const { data, info } = await sharp(file).extract({ left, top, width: bandW, height: bandH }).raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (g > 90 && g > r * 1.35 && g > b * 1.35) n++;
    }
    return n;
  };
  const topRight = await greens(meta.width - bandW, 0);
  const bottomLeft = await greens(0, meta.height - bandH);
  return bottomLeft > 50 && bottomLeft > topRight * 3;
}

/** Apple's own marketing clock, full battery, no carrier noise. tvOS draws no status bar. */
export async function cleanStatusBar(udid) {
  await simctl([
    "status_bar",
    udid,
    "override",
    "--time",
    "9:41",
    "--dataNetwork",
    "wifi",
    "--wifiMode",
    "active",
    "--wifiBars",
    "3",
    "--cellularMode",
    "active",
    "--cellularBars",
    "4",
    "--operatorName",
    "",
    "--batteryState",
    "charged",
    "--batteryLevel",
    "100",
  ]);
}

export async function clearStatusBar(udid) {
  await simctl(["status_bar", udid, "clear"]).catch(() => {});
}

/**
 * A dev-client build carries no bundle, so a bare launch leaves it with a null script URL
 * and a red error screen. Opening the dev-client link both launches it and says where
 * Metro is. Release builds have no such link and take the plain launch.
 */
export async function relaunch(udid, bundleId, { scheme, metroUrl } = {}) {
  await simctl(["terminate", udid, bundleId]).catch(() => {});
  if (scheme && metroUrl) {
    await simctl(["openurl", udid, `${scheme}://expo-development-client/?url=${encodeURIComponent(metroUrl)}`]);
    return;
  }
  await simctl(["launch", udid, bundleId]);
}

/** Whether Metro is answering, so capture knows which launch style to use. */
export async function metroUp(metroUrl) {
  try {
    const res = await fetch(`${metroUrl}/status`, { signal: AbortSignal.timeout(3000) });
    return (await res.text()).includes("packager-status:running");
  } catch {
    return false;
  }
}
