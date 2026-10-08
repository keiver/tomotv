import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-native-lock-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  for (const file of ["native-build-lock.py", "native-build-lock.sh"]) fs.copyFileSync(`scripts/${file}`, path.join(root, "scripts", file));
  const script = (name, body) => fs.writeFileSync(path.join(root, "scripts", name), `#!/bin/bash\nset -euo pipefail\nsource scripts/native-build-lock.sh\n${body}\n`);
  return { root, script };
}

test("overlapping prebuilds wait until the shared ios tree is restored", { timeout: 10000 }, async (t) => {
  const { root, script } = fixture(t);
  fs.mkdirSync(path.join(root, "ios"));
  fs.writeFileSync(path.join(root, "ios/platform"), "iOS");
  script("first.sh", "mv ios parked\necho parked\nread -r release\nmv parked ios");
  script("second.sh", "test -d ios\ntest ! -d parked\ncat ios/platform");
  const first = spawn("bash", ["scripts/first.sh"], { cwd: root });
  t.after(() => first.kill("SIGKILL"));
  const firstExit = once(first, "close");
  await once(first.stdout, "data");
  const second = spawn("bash", ["scripts/second.sh"], { cwd: root });
  t.after(() => second.kill("SIGKILL"));
  const secondExit = once(second, "close");
  let output = "";
  second.stdout.on("data", (data) => (output += data));
  const [waiting] = await once(second.stderr, "data");
  assert.match(waiting.toString(), /Waiting for it to finish/);
  assert.equal(output, "");
  first.stdin.end("release\n");
  assert.equal((await firstExit)[0], 0);
  assert.equal((await secondExit)[0], 0);
  assert.equal(output, "iOS");
});

test("nested platform scripts reuse the parent lock", (t) => {
  // Independent invocations still acquire it; only an inherited open descriptor reuses it.
  const { root, script } = fixture(t);
  script("parent.sh", "bash scripts/child.sh\necho parent");
  script("child.sh", "echo child");
  const result = spawnSync("bash", ["scripts/parent.sh"], { cwd: root, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "child\nparent\n");
});

test("clear can release native preparation before starting its long-running server", (t) => {
  const { root, script } = fixture(t);
  script("parent.sh", "native_build_unlock\nbash scripts/child.sh");
  script("child.sh", "echo acquired");
  const result = spawnSync("bash", ["scripts/parent.sh"], { cwd: root, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "acquired\n");
});

test("the clear entry point completes nested prebuilds and releases its lock for Metro", (t) => {
  const { root, script } = fixture(t);
  fs.copyFileSync("scripts/clear.sh", path.join(root, "scripts/clear.sh"));
  for (const file of ["check-xcode-tools.sh", "check-firewall.sh"]) fs.writeFileSync(path.join(root, "scripts", file), "exit 0\n");
  script("prebuild-all.sh", "echo prebuilt");
  fs.mkdirSync(path.join(root, "bin"));
  for (const [name, body] of Object.entries({
    pgrep: "exit 1",
    open: "exit 0",
    // A fresh process must be able to acquire the lock while Metro is running.
    npx: 'exec python3 scripts/native-build-lock.py bash -c "echo metro"',
  }))
    fs.writeFileSync(path.join(root, "bin", name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  const result = spawnSync("bash", ["scripts/clear.sh"], {
    cwd: root,
    env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "prebuilt\nmetro\n");
});

test("a killed build releases its lock without manual cleanup", { timeout: 10000 }, async (t) => {
  const { root, script } = fixture(t);
  script("first.sh", "echo held\nread -r release");
  script("second.sh", "exit 7");
  const first = spawn("bash", ["scripts/first.sh"], { cwd: root });
  t.after(() => first.kill("SIGKILL"));
  const exited = once(first, "close");
  await once(first.stdout, "data");
  first.kill("SIGKILL");
  await exited;
  const result = spawnSync("bash", ["scripts/second.sh"], { cwd: root, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 7, result.stderr);
});
