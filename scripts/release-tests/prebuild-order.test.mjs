import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-prebuild-order-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "bin", "plugins", "patches", "assets/brand", "modules", "packages/tomo-live", "packages/tomo-engine/ios", "node_modules"])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of [
    "prebuild-all.sh",
    "prebuild-dual.sh",
    "prebuild-mac.sh",
    "make-dual-workspace.sh",
    "native-build-lock.sh",
    "native-build-lock.py",
    "preserve-mtimes.py",
    "catalyst-frameworks.rb",
    "fix-catalyst-framework.py",
    "prebuilt-swift-imports.rb",
  ])
    fs.copyFileSync(`scripts/${file}`, path.join(root, "scripts", file));
  for (const file of ["app.json", "package.json", "package-lock.json", "node_modules/.package-lock.json", "packages/tomo-engine/ffmpeg-lock.json"]) fs.writeFileSync(path.join(root, file), "{}\n");
  for (const pod of ["TomoEngine", "TomoLiveSources", "TomoFFmpeg"]) fs.writeFileSync(path.join(root, "packages/tomo-engine/ios", `${pod}.podspec`), "# fixture\n");
  for (const file of ["check-xcode-tools.sh", "rn-artifact-cache.sh"]) fs.writeFileSync(path.join(root, "scripts", file), "exit 0\n");
  fs.writeFileSync(path.join(root, "scripts/check-catalyst-frameworks.py"), "pass\n");
  // Pods dependency wiring is covered by workspace.test.mjs. Here the actual
  // shell scripts move and rename projects while Expo/CocoaPods are stand-ins.
  fs.writeFileSync(path.join(root, "scripts/link-platform-pods.js"), "");
  const tool = (name, body) => fs.writeFileSync(path.join(root, "bin", name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 });
  tool(
    "expo",
    `platform=ios
if [ "$EXPO_TV" = 1 ]; then platform=tvos; fi
if [ "$EXPO_MACCATALYST" = 1 ]; then platform=macos; fi
mode=--no-clean
case " $* " in *" --clean "*) mode=--clean; rm -rf ios ;; esac
echo "$platform:$mode" >> "$TRACE"
mkdir -p ios/TomoTV.xcodeproj/xcshareddata/xcschemes ios/TomoTV.xcworkspace
echo "$platform" > ios/platform
echo 'Pods.xcodeproj' > ios/TomoTV.xcodeproj/project.pbxproj
echo 'container:TomoTV.xcodeproj' > ios/TomoTV.xcodeproj/xcshareddata/xcschemes/TomoTV.xcscheme
if [ "$platform" = "$FAIL_PLATFORM" ]; then exit 27; fi`,
  );
  tool(
    "pod",
    `if [ "$1" = --version ]; then echo 1.0; exit 0; fi
platform=$(basename "$PWD")
test "$(cat platform)" = "$platform"
echo "$platform:pods" >> "$TRACE"
mkdir -p Pods/Pods.xcodeproj`,
  );
  tool("npx", 'test "$1" = expo\nshift\nexec expo "$@"');
  tool("stat", "echo 0");
  if (process.platform !== "darwin") tool("sed", 'if [ "$1" = -i ] && [ "$2" = "" ]; then shift 2; exec /usr/bin/sed -i "$@"; fi\nexec /usr/bin/sed "$@"');
  const trace = path.join(root, "trace");
  const run = (extraEnv = {}, script = "prebuild-all.sh") => {
    fs.writeFileSync(trace, "");
    return spawnSync("bash", [`scripts/${script}`], {
      cwd: root,
      env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, TRACE: trace, FAIL_PLATFORM: "", ...extraEnv },
      encoding: "utf8",
      timeout: 15000,
    });
  };
  const events = () => fs.readFileSync(trace, "utf8").trim().split("\n").filter(Boolean);
  const assertProjects = () => {
    for (const [dir, suffix] of Object.entries({ ios: "iOS", macos: "macOS", tvos: "tvOS" })) {
      assert.equal(fs.readFileSync(path.join(root, dir, "platform"), "utf8"), `${dir}\n`);
      assert.ok(fs.existsSync(path.join(root, dir, `TomoTV-${suffix}.xcodeproj`)));
      assert.ok(fs.existsSync(path.join(root, dir, `Pods/Pods-${suffix}.xcodeproj`)));
    }
    assert.equal(fs.existsSync(path.join(root, "ios.iphone")), false);
    assert.equal(fs.existsSync(path.join(root, ".prebuild-mac-backup")), false);
  };
  return { root, run, events, assertProjects };
}

test("all-platform generation runs iOS, Mac, then tvOS on clean and cached runs", (t) => {
  const { run, events, assertProjects } = fixture(t);
  const clean = run();
  assert.equal(clean.status, 0, clean.stderr);
  assert.deepEqual(events(), ["ios:--clean", "ios:pods", "macos:--clean", "macos:pods", "tvos:--clean", "tvos:pods"]);
  assertProjects();
  const cached = run();
  assert.equal(cached.status, 0, cached.stderr);
  assert.deepEqual(events(), ["ios:--no-clean", "macos:--no-clean", "tvos:--no-clean"]);
  assertProjects();
});

test("offline with changed pod inputs runs no prebuild or pod install and keeps the projects", (t) => {
  const { root, run, events, assertProjects } = fixture(t);
  const clean = run();
  assert.equal(clean.status, 0, clean.stderr);
  fs.writeFileSync(path.join(root, "packages/tomo-engine/ffmpeg-lock.json"), '{"changed":true}\n');
  const offline = run({ TOMOTV_OFFLINE: "1" });
  assert.equal(offline.status, 0, offline.stderr);
  assert.deepEqual(events(), []);
  assertProjects();
  const online = run();
  assert.equal(online.status, 0, online.stderr);
  assert.deepEqual(events(), ["ios:--no-clean", "ios:pods", "macos:--no-clean", "macos:pods", "tvos:--no-clean", "tvos:pods"]);
});

test("offline with unchanged inputs updates the projects in place as usual", (t) => {
  const { run, events, assertProjects } = fixture(t);
  const clean = run();
  assert.equal(clean.status, 0, clean.stderr);
  const offline = run({ TOMOTV_OFFLINE: "1" });
  assert.equal(offline.status, 0, offline.stderr);
  assert.deepEqual(events(), ["ios:--no-clean", "macos:--no-clean", "tvos:--no-clean"]);
  assertProjects();
});

test("offline with no projects to keep fails before anything is generated", (t) => {
  const { root, run, events } = fixture(t);
  const offline = run({ TOMOTV_OFFLINE: "1" });
  assert.equal(offline.status, 1, offline.stderr);
  assert.match(offline.stderr, /no complete iOS and tvOS projects to keep/);
  assert.deepEqual(events(), []);
  assert.equal(fs.existsSync(path.join(root, "ios")), false);
});

for (const flag of ["--tv", "--ios", "--npm"]) {
  test(`clear --offline ${flag} is refused and removes nothing`, (t) => {
    const { root } = fixture(t);
    fs.copyFileSync("scripts/clear.sh", path.join(root, "scripts/clear.sh"));
    fs.writeFileSync(path.join(root, "bin/open"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
    const kept = ["ios/kept", "node_modules/kept", ".expo/kept", "package-lock.json"];
    for (const file of kept) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), "{}\n");
    }
    const result = spawnSync("bash", ["scripts/clear.sh", "--offline", flag], {
      cwd: root,
      env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, TOMOTV_OFFLINE: "" },
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`--offline cannot be combined with ${flag}`));
    for (const file of kept) assert.ok(fs.existsSync(path.join(root, file)), file);
  });
}

for (const cached of [false, true]) {
  test(`failed tvOS generation restores iOS and preserves Mac (${cached ? "cached" : "clean"})`, (t) => {
    const { root, run, assertProjects } = fixture(t);
    if (cached) {
      const initial = run();
      assert.equal(initial.status, 0, initial.stderr);
    }
    const failed = run({ FAIL_PLATFORM: "tvos" });
    assert.equal(failed.status, 27, failed.stderr);
    assert.equal(fs.readFileSync(path.join(root, "ios/platform"), "utf8"), "ios\n");
    assert.equal(fs.readFileSync(path.join(root, "macos/platform"), "utf8"), "macos\n");
    assert.equal(fs.existsSync(path.join(root, "ios.iphone")), false);
    assert.equal(fs.existsSync(path.join(root, "tvos/.prebuild-inputs")), false);
    const recovered = run();
    assert.equal(recovered.status, 0, recovered.stderr);
    assertProjects();
  });
}

test("dual-platform generation keeps iOS before tvOS without requiring Mac", (t) => {
  const { root, run, events } = fixture(t);
  const result = run({}, "prebuild-dual.sh");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(events(), ["ios:--clean", "ios:pods", "tvos:--clean", "tvos:pods"]);
  assert.equal(fs.existsSync(path.join(root, "macos")), false);
});
