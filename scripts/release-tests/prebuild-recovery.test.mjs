import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("recovery after restoring iOS leaves both final projects intact", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-prebuild-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "ios", "macos", ".prebuild-mac-backup"]) fs.mkdirSync(path.join(root, dir));
  for (const file of ["prebuild-mac.sh", "native-build-lock.sh", "native-build-lock.py"]) fs.copyFileSync(`scripts/${file}`, path.join(root, "scripts", file));
  fs.writeFileSync(path.join(root, "ios/original"), "iOS project");
  fs.writeFileSync(path.join(root, "macos/generated"), "Catalyst project");
  const result = spawnSync("bash", ["scripts/prebuild-mac.sh", "--recover"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(root, "ios/original"), "utf8"), "iOS project");
  assert.equal(fs.readFileSync(path.join(root, "macos/generated"), "utf8"), "Catalyst project");
});

for (const interruptedBeforeGeneration of [true, false])
  test(`interrupted Mac prebuild restores iOS (${interruptedBeforeGeneration ? "before" : "after"} generation)`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-prebuild-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, "scripts"));
    for (const file of ["prebuild-mac.sh", "native-build-lock.sh", "native-build-lock.py"]) fs.copyFileSync(`scripts/${file}`, path.join(root, "scripts", file));
    fs.mkdirSync(path.join(root, ".prebuild-mac-backup/ios"), { recursive: true });
    fs.writeFileSync(path.join(root, ".prebuild-mac-backup/ios/original"), "iOS project");
    if (!interruptedBeforeGeneration) {
      fs.mkdirSync(path.join(root, "ios"));
      fs.writeFileSync(path.join(root, "ios/generated"), "Catalyst project");
    }
    const result = spawnSync("bash", ["scripts/prebuild-mac.sh", "--recover"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(root, "ios/original"), "utf8"), "iOS project");
    assert.equal(fs.existsSync(path.join(root, ".prebuild-mac-backup")), false);
    if (!interruptedBeforeGeneration) assert.equal(fs.readFileSync(path.join(root, "macos/generated"), "utf8"), "Catalyst project");
  });
