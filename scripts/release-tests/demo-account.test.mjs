import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const here = path.dirname(new URL(import.meta.url).pathname);
const folder = path.join(here, "..", "demo-account");
const read = (name) => fs.readFileSync(path.join(folder, name), "utf8");

/** The library names setup.py creates or shares with the demo user. */
function libraryNames() {
  const setup = read("setup.py");
  const names = [...setup.matchAll(/\{"name": "([^"]+)", "type"/g)].map((m) => m[1]);
  const shared = /SHARED_LIBRARIES = \[([^\]]*)\]/.exec(setup);
  return new Set([...names, ...[...(shared?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1])]);
}

test("the demo account deploy is executable and reads its ssh target from .env.demo", () => {
  const script = path.join(folder, "deploy.sh");
  assert.ok(fs.statSync(script).mode & 0o111, "deploy.sh is not executable");
  const text = fs.readFileSync(script, "utf8");
  assert.match(text, /\.env\.demo/);
  assert.match(text, /DEMO_SSH_KEY/);
});

test("every seed entry and library image names a library the demo user sees", () => {
  const names = libraryNames();
  assert.ok(names.size >= 5, `too few libraries parsed from setup.py: ${[...names].join(", ")}`);
  const seed = JSON.parse(read("seed.json"));
  for (const entry of [...seed.favorites, ...seed.progress]) {
    assert.ok(names.has(entry.library), `seed.json names a library the demo user does not see: ${entry.library} (${entry.title})`);
  }
  for (const art of JSON.parse(read("library-art.json"))) {
    assert.ok(names.has(art.library), `library-art.json names a library the demo user does not see: ${art.library}`);
  }
});

test("no library name carries the word Demo", () => {
  for (const name of libraryNames()) assert.doesNotMatch(name, /demo/i);
});

test("the deploy installs the box monitor and its cron entry", () => {
  const text = read("deploy.sh");
  assert.match(text, /boxwatch\.py/);
  assert.match(text, /tomotv-boxwatch/);
  assert.match(text, /DEMO_NTFY_TOPIC/);
});

test("the box monitor's decisions pass their unit tests", () => {
  const run = spawnSync("python3", ["-m", "unittest", "discover", "-s", folder, "-p", "test_boxwatch.py"], { encoding: "utf8" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});
