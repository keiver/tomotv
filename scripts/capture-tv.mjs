#!/usr/bin/env node
/**
 * Screenshot a physical Apple TV to ~/Desktop.
 *
 * Usage:
 *   npm run capture-tv                 first Apple TV found, connected ones first
 *   npm run capture-tv -- "<device>"   a name, UDID or identifier devicectl accepts
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

let device = process.argv[2];
let name = device;

if (!device) {
  const raw = execFileSync("xcrun", ["devicectl", "list", "devices", "--json-output", "-"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const tvs = JSON.parse(raw).result.devices.filter((d) => d.hardwareProperties?.deviceType === "appleTV" && d.hardwareProperties?.reality === "physical");
  const tv = tvs.find((d) => d.connectionProperties?.tunnelState === "connected") ?? tvs[0];
  if (!tv) {
    console.error("No paired Apple TV found.");
    process.exit(1);
  }
  device = tv.identifier;
  name = tv.deviceProperties?.name ?? tv.identifier;
}

const safe = name.replace(/[^\w.-]+/g, "_");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const file = path.join(os.homedir(), "Desktop", `${safe}-${stamp}.png`);

try {
  execFileSync("xcrun", ["devicectl", "device", "capture", "screenshot", "--device", device, "--destination", file], {
    stdio: ["ignore", "ignore", "inherit"],
  });
} catch {
  process.exit(1);
}
console.log(`${name} -> ${file}`);
