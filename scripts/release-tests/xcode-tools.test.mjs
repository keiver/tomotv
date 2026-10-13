import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

function fixture(t, { installed = false, cached = false, failure = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-xcode-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, "xcrun"),
    `#!/bin/bash
if [ "$1" = --kill-cache ]; then
  [ -f "$TEST_STATE/cached" ] && touch "$TEST_STATE/installed"
  exit 0
fi
if [ -f "$TEST_STATE/installed" ]; then echo 'Apple metal version test'; exit 0; fi
echo "error: cannot execute tool 'metal' due to missing Metal Toolchain" >&2
exit 1
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(dir, "xcodebuild"),
    `#!/bin/bash
echo "$*" >> "$TEST_STATE/downloads"
[ -f "$TEST_STATE/failure" ] && exit 9
touch "$TEST_STATE/cached"
`,
    { mode: 0o755 },
  );
  for (const [key, enabled] of Object.entries({ installed, cached, failure })) if (enabled) fs.writeFileSync(path.join(dir, key), "");
  return {
    run: (args = [], env = {}) =>
      spawnSync("bash", ["scripts/check-xcode-tools.sh", ...args], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${dir}:/usr/bin:/bin`, TEST_STATE: dir, TOMOTV_INSTALL_XCODE_COMPONENTS: "0", ...env },
      }),
    downloads: () => (fs.existsSync(path.join(dir, "downloads")) ? fs.readFileSync(path.join(dir, "downloads"), "utf8").trim().split("\n") : []),
  };
}

test("installed compiler needs no download", (t) => {
  const f = fixture(t, { installed: true });
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.downloads(), []);
});
test("stale compiler lookup is refreshed before requesting installation", (t) => {
  const f = fixture(t, { cached: true });
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.downloads(), []);
});
test("noninteractive builds explain the missing component without installing without consent", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /setup:xcode -- --install/);
  assert.deepEqual(f.downloads(), []);
});
for (const mode of ["flag", "environment"])
  test(`explicit ${mode} authorization installs and verifies Metal`, (t) => {
    const f = fixture(t);
    const result = mode === "flag" ? f.run(["--install"]) : f.run([], { TOMOTV_INSTALL_XCODE_COMPONENTS: "1" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.downloads(), ["-downloadComponent MetalToolchain"]);
    assert.equal(f.run().status, 0);
    assert.equal(f.downloads().length, 1);
  });
test("failed installation fails the build", (t) => {
  const f = fixture(t, { failure: true });
  assert.equal(f.run(["--install"]).status, 9);
});
