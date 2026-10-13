import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const script = path.resolve("scripts/prebuilt-swift-imports.rb");
const apply = `
require 'json'
phase = Struct.new(:display_name)
target = Struct.new(:isa, :name, :build_phases)
targets = JSON.parse(ARGV.fetch(1)).map { |t| target.new(t['isa'], t['name'], t['phases'].map { |name| phase.new(name) }) }
installer = Struct.new(:pods_project, :sandbox).new(Struct.new(:targets).new(targets), Struct.new(:root).new(ARGV.fetch(0)))
TomoPrebuiltSwiftImports.apply(installer)
`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-prebuilt-imports-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = [];
  const contents = [
    'SWIFT_INCLUDE_PATHS = $(inherited) "${PODS_CONFIGURATION_BUILD_DIR}/ExpoModulesCore" "$(PODS_CONFIGURATION_BUILD_DIR)/ExpoFileSystem" ${PODS_CONFIGURATION_BUILD_DIR}/ExpoFont "${PODS_CONFIGURATION_BUILD_DIR}/ExpoBlur" "${PODS_CONFIGURATION_BUILD_DIR}/ExpoModulesCoreExtras" "${PODS_XCFRAMEWORKS_BUILD_DIR}/ExpoModulesCore"',
    'SWIFT_INCLUDE_PATHS[sdk=iphoneos*] = $(inherited) "${PODS_CONFIGURATION_BUILD_DIR}/ExpoModulesCore"',
    'FRAMEWORK_SEARCH_PATHS = $(inherited) "${PODS_XCFRAMEWORKS_BUILD_DIR}/ExpoModulesCore"',
    'HEADER_SEARCH_PATHS = $(inherited) "${PODS_ROOT}/Headers/Public"',
    'OTHER_LDFLAGS = $(inherited) -framework "ExpoModulesCore"',
    "",
  ].join("\n");
  for (const pod of ["Pods-TomoTV", "ExpoBlur", "ExpoFileSystem"]) {
    const dir = path.join(root, "Target Support Files", pod);
    fs.mkdirSync(dir, { recursive: true });
    for (const config of ["debug", "release"]) {
      const file = path.join(dir, `${pod}.${config}.xcconfig`);
      fs.writeFileSync(file, contents);
      files.push(file);
    }
  }
  const run = (targets) => {
    const result = spawnSync("ruby", ["-r", script, "-e", apply, root, JSON.stringify(targets)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  return { files, contents, run };
}

test("prebuilt pods cannot import stale source modules in app or pod Debug/Release configurations", (t) => {
  const { files, contents, run } = fixture(t);
  const targets = ["ExpoModulesCore", "ExpoFileSystem", "ExpoFont"].map((name) => ({ isa: "PBXAggregateTarget", name, phases: ["[CP] Copy XCFrameworks"] }));
  // A pod that compiles sources may also vendor a dependency: retain its module path.
  targets.push({ isa: "PBXNativeTarget", name: "ExpoBlur", phases: ["Sources", "[CP] Copy XCFrameworks"] });
  targets.push({ isa: "PBXAggregateTarget", name: "ExpoModulesCoreExtras", phases: ["Resources"] });
  const expected = contents
    .replaceAll(' "${PODS_CONFIGURATION_BUILD_DIR}/ExpoModulesCore"', "")
    .replaceAll(' "$(PODS_CONFIGURATION_BUILD_DIR)/ExpoFileSystem"', "")
    .replaceAll(" ${PODS_CONFIGURATION_BUILD_DIR}/ExpoFont", "");
  run(targets);
  const mtimes = files.map((file) => fs.statSync(file).mtimeMs);
  run(targets);
  files.forEach((file, index) => {
    assert.equal(fs.readFileSync(file, "utf8"), expected);
    assert.equal(fs.statSync(file).mtimeMs, mtimes[index], "repeated integration must not invalidate unchanged configs");
  });
});

test("source-built Expo pods retain their Swift module paths", (t) => {
  const { files, contents, run } = fixture(t);
  run(["ExpoModulesCore", "ExpoFileSystem", "ExpoFont"].map((name) => ({ isa: "PBXNativeTarget", name, phases: ["Sources"] })));
  for (const file of files) assert.equal(fs.readFileSync(file, "utf8"), contents);
});
