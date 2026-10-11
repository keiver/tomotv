import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const name = "ReactNativeDependencies";
const repairScript = path.resolve("scripts/fix-catalyst-framework.py");
const hookScript = path.resolve("scripts/catalyst-frameworks.rb");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-catalyst-framework-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const framework = path.join(root, "embedded", `${name}.framework`);
  const version = path.join(framework, "Versions/A");
  fs.mkdirSync(path.join(version, "Resources"), { recursive: true });
  fs.writeFileSync(path.join(version, name), "universal Catalyst binary");
  fs.writeFileSync(
    path.join(version, "Resources/Info.plist"),
    `<plist version="1.0"><dict><key>CFBundlePackageType</key><string>FMWK</string><key>CFBundleExecutable</key><string>${name}</string></dict></plist>`,
  );
  fs.cpSync(version, path.join(framework, "Versions/Current"), { recursive: true });
  fs.cpSync(path.join(version, "Resources"), path.join(framework, "Resources"), { recursive: true });
  fs.copyFileSync(path.join(version, name), path.join(framework, name));
  for (const dependency of ["boost", "folly", "glog"]) {
    const resources = path.join(framework, `${name}_${dependency}.bundle/Contents/Resources`);
    fs.mkdirSync(resources, { recursive: true });
    fs.writeFileSync(path.join(resources, "PrivacyInfo.xcprivacy"), `${dependency} privacy manifest`);
  }
  return { root, framework, version };
}

function assertLayout(framework) {
  // Apple's validateFrameworkRoot permits root links only to the same name
  // directly in Versions/Current (or Versions/A), never nested resources.
  assert.deepEqual(fs.readdirSync(framework).sort(), [name, "Resources", "Versions"].sort());
  assert.equal(fs.readlinkSync(path.join(framework, "Versions/Current")), "A");
  assert.equal(fs.readlinkSync(path.join(framework, name)), `Versions/Current/${name}`);
  assert.equal(fs.readlinkSync(path.join(framework, "Resources")), "Versions/Current/Resources");
  assert.equal(fs.readFileSync(path.join(framework, name), "utf8"), "universal Catalyst binary");
  for (const dependency of ["boost", "folly", "glog"]) {
    const bundle = `${name}_${dependency}.bundle`;
    assert.equal(fs.readFileSync(path.join(framework, `Resources/${bundle}/Contents/Resources/PrivacyInfo.xcprivacy`), "utf8"), `${dependency} privacy manifest`);
    assert.equal(fs.readFileSync(path.join(framework, `Versions/A/Resources/${bundle}/Contents/Resources/PrivacyInfo.xcprivacy`), "utf8"), `${dependency} privacy manifest`);
  }
}

test("flattened Catalyst links and privacy bundles are restored without changing the binary; repeating is harmless", (t) => {
  const { framework, version } = fixture(t);
  const original = fs.statSync(path.join(version, name));
  for (let run = 0; run < 2; run++) {
    const result = spawnSync("python3", [repairScript, framework], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assertLayout(framework);
    assert.equal(fs.statSync(path.join(version, name)).mtimeMs, original.mtimeMs);
  }
});

test("removes old root resource aliases while preserving the manifests they referenced", (t) => {
  const { framework, version } = fixture(t);
  for (const [entry, target] of [
    ["Versions/Current", "A"],
    [name, `Versions/Current/${name}`],
    ["Resources", "Versions/Current/Resources"],
  ]) {
    const file = path.join(framework, entry);
    fs.rmSync(file, { recursive: true });
    fs.symlinkSync(target, file);
  }
  for (const dependency of ["boost", "folly", "glog"]) {
    const bundle = `${name}_${dependency}.bundle`;
    fs.renameSync(path.join(framework, bundle), path.join(version, "Resources", bundle));
    fs.symlinkSync(`Versions/Current/Resources/${bundle}`, path.join(framework, bundle));
  }
  const result = spawnSync("python3", [repairScript, framework], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assertLayout(framework);
});

test("different framework copies fail before replacing any links", (t) => {
  const { framework } = fixture(t);
  fs.writeFileSync(path.join(framework, name), "different binary");
  const result = spawnSync("python3", [repairScript, framework], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Framework copies differ/);
  assert.equal(fs.lstatSync(path.join(framework, "Versions/Current")).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(framework, name), "utf8"), "different binary");
});

for (const configuration of ["Debug", "Release"]) {
  for (const platform of ["-maccatalyst", "-iphoneos", "-appletvos"]) {
    test(`${configuration} embedding repairs only Catalyst before stripping and signing (${platform})`, (t) => {
      const { root, framework } = fixture(t);
      const pods = path.join(root, "macos/Pods");
      fs.mkdirSync(pods, { recursive: true });
      fs.mkdirSync(path.join(root, "scripts"));
      fs.copyFileSync(repairScript, path.join(root, "scripts/fix-catalyst-framework.py"));
      const embed = path.join(root, "embed.sh");
      // The fixture uses CocoaPods' actual insertion point, before binary resolution,
      // architecture stripping and codesign. No native tools are executed.
      const input = `#!/bin/bash
set -euo pipefail
install_framework() {
  local destination="$EMBED_DESTINATION"
  local basename
  basename="$(basename -s .framework "$1")"
  binary="$destination/$basename.framework/$basename"
  if [[ "$EFFECTIVE_PLATFORM_NAME" == "-maccatalyst" ]]; then
    test -L "$binary"
    test -L "$destination/$basename.framework/Versions/Current"
  else
    test ! -L "$binary"
  fi
}
if [[ "$CONFIGURATION" == "Debug" ]]; then install_framework "ReactNativeDependencies.framework"; fi
if [[ "$CONFIGURATION" == "Release" ]]; then install_framework "ReactNativeDependencies.framework"; fi
`;
      fs.writeFileSync(embed, input);
      let patched;
      for (let run = 0; run < 2; run++) {
        const result = spawnSync("ruby", ["-r", hookScript, "-e", "TomoCatalystFrameworks.patch_embed_script(ARGV.fetch(0))", embed], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        const contents = fs.readFileSync(embed, "utf8");
        if (run) assert.equal(contents, patched);
        patched = contents;
      }
      const result = spawnSync("bash", [embed], {
        env: { ...process.env, PODS_ROOT: pods, EMBED_DESTINATION: path.dirname(framework), CONFIGURATION: configuration, EFFECTIVE_PLATFORM_NAME: platform },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      if (platform === "-maccatalyst") assertLayout(framework);
    });
  }
}
