import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const source = fs.readFileSync("scripts/archive-both.sh", "utf8");
const functions = ["is_seed_build", "xcode_license"].map((name) => source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"))[0]).join("\n");
const run = (command) => spawnSync("bash", ["-c", `${functions}\n${command}`], { encoding: "utf8" });

function fakeXcode(t, licenseType) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-xcode-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "Contents/Developer"), { recursive: true });
  fs.mkdirSync(path.join(root, "Contents/Resources"));
  if (licenseType) {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>licenseType</key><string>${licenseType}</string></dict></plist>\n`;
    fs.writeFileSync(path.join(root, "Contents/Resources/LicenseInfo.plist"), plist);
  }
  return path.join(root, "Contents/Developer");
}

test("an Xcode release or RC reads as GM", (t) => {
  assert.equal(run(`xcode_license "${fakeXcode(t, "GM")}"`).stdout.trim(), "GM");
});

test("a beta Xcode reads as Beta", (t) => {
  assert.equal(run(`xcode_license "${fakeXcode(t, "Beta")}"`).stdout.trim(), "Beta");
});

test("an Xcode without LicenseInfo.plist reads as missing", (t) => {
  assert.equal(run(`xcode_license "${fakeXcode(t, null)}"`).stdout.trim(), "missing");
});

test("macOS builds numbered 5000 and up are seeds, lower ones are releases", () => {
  for (const build of ["26A5368g", "26A5421a"]) assert.equal(run(`is_seed_build ${build}`).status, 0, build);
  for (const build of ["25G83", "26A434", "23F81a"]) assert.equal(run(`is_seed_build ${build}`).status, 1, build);
});
