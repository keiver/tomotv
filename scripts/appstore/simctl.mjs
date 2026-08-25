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

export async function relaunch(udid, bundleId) {
  await simctl(["terminate", udid, bundleId]).catch(() => {});
  await simctl(["launch", udid, bundleId]);
}
