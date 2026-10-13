import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

for (const corrupt of [false, true]) {
  test(`local FFmpeg installation from npm's package directory ${corrupt ? "rejects a bad checksum" : "resolves the caller's relative path"}`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-local-ffmpeg-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const engine = path.join(root, "packages/tomo-engine");
    fs.mkdirSync(path.join(engine, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, ".ffmpeg-build/dist"), { recursive: true });
    fs.copyFileSync("packages/tomo-engine/scripts/fetch-ffmpeg.js", path.join(engine, "scripts/fetch-ffmpeg.js"));
    const bytes = Buffer.from("fixture artifact");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    fs.writeFileSync(path.join(root, ".ffmpeg-build/dist/Libavcodec.xcframework.zip"), corrupt ? "changed artifact" : bytes);
    fs.writeFileSync(path.join(engine, "ffmpeg-lock.json"), JSON.stringify({ repository: "fixture/repo", tag: "local-only", artifacts: { Libavcodec: checksum } }));
    // Exercise the installer in a child with npm's actual cwd/env arrangement.
    // Only archive extraction is stubbed; no network or native tools may run.
    const shim = path.join(root, "shim.cjs");
    fs.writeFileSync(
      shim,
      `const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
Object.defineProperty(process, 'platform', { value: 'darwin' });
require('node:child_process').execFileSync = (command, args) => {
  assert.equal(command, 'unzip', 'local installation must not contact the network');
  const framework = path.join(args[args.indexOf('-d') + 1], 'Libavcodec.xcframework');
  fs.mkdirSync(framework, { recursive: true });
  fs.writeFileSync(path.join(framework, 'Info.plist'), 'fixture');
};
`,
    );
    const result = spawnSync(process.execPath, ["--require", shim, "scripts/fetch-ffmpeg.js"], {
      cwd: engine,
      env: { ...process.env, INIT_CWD: root, TOMO_FFMPEG_ARTIFACTS_DIR: ".ffmpeg-build/dist" },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, corrupt ? 1 : 0, result.stderr);
    const stamp = path.join(engine, "ios/Frameworks/.installed.json");
    if (corrupt) {
      assert.match(result.stderr, /Checksum mismatch/);
      assert.equal(fs.existsSync(stamp), false);
    } else {
      assert.equal(JSON.parse(fs.readFileSync(stamp, "utf8")).Libavcodec, checksum);
      assert.ok(fs.existsSync(path.join(engine, "ios/Frameworks/Libavcodec.xcframework/Info.plist")));
    }
  });
}
