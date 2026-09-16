#!/usr/bin/env node
/**
 * Screenshot every booted simulator (iOS, iPadOS, tvOS) in one shot.
 *
 * Usage:
 *   npm run shots:sims              write PNGs to ~/Desktop
 *   npm run shots:sims -- <dir>     write them somewhere else
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(os.homedir(), "Desktop");

// -j gives one flat map of runtime -> devices; only Booted ones can be shot.
const raw = execFileSync("xcrun", ["simctl", "list", "devices", "booted", "-j"], { encoding: "utf8" });
const booted = Object.values(JSON.parse(raw).devices)
  .flat()
  .filter((d) => d.state === "Booted");

if (booted.length === 0) {
  console.log("No booted simulators.");
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

for (const device of booted) {
  const safe = device.name.replace(/[^\w.-]+/g, "_");
  const file = path.join(outDir, `${safe}-${stamp}.png`);
  execFileSync("xcrun", ["simctl", "io", device.udid, "screenshot", file], { stdio: "inherit" });
  console.log(`${device.name} -> ${file}`);
}
