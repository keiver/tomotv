import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import xcode from "xcode";

function projectFixture(targetName) {
  return `// !$*UTF8*$!
{
  archiveVersion = 1;
  classes = {};
  objectVersion = 54;
  objects = {
    AAAAAAAAAAAAAAAAAAAAAAAA = { isa = PBXProject; mainGroup = BBBBBBBBBBBBBBBBBBBBBBBB; targets = (CCCCCCCCCCCCCCCCCCCCCCCC,); };
    BBBBBBBBBBBBBBBBBBBBBBBB = { isa = PBXGroup; children = (); sourceTree = "<group>"; };
    CCCCCCCCCCCCCCCCCCCCCCCC = { isa = PBXNativeTarget; name = "${targetName}"; dependencies = (); };
  };
  rootObject = AAAAAAAAAAAAAAAAAAAAAAAA;
}
`;
}

test("all projects, Pods, and schemes use the iOS/tvOS/macOS naming pattern", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-workspace-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  for (const file of ["make-dual-workspace.sh", "native-build-lock.sh", "native-build-lock.py", "link-platform-pods.js"]) fs.copyFileSync(`scripts/${file}`, path.join(root, "scripts", file));
  const platforms = { ios: "iOS", tvos: "tvOS", macos: "macOS" };
  for (const dir of Object.keys(platforms)) {
    const schemes = path.join(root, dir, "TomoTV.xcodeproj/xcshareddata/xcschemes");
    fs.mkdirSync(schemes, { recursive: true });
    fs.writeFileSync(
      path.join(schemes, "TomoTV.xcscheme"),
      '<Scheme><BuildAction buildImplicitDependencies="YES"><BuildableReference ReferencedContainer="container:TomoTV.xcodeproj"/></BuildAction></Scheme>',
    );
    fs.writeFileSync(path.join(root, dir, "TomoTV.xcodeproj/project.pbxproj"), projectFixture("TomoTV"));
    fs.mkdirSync(path.join(root, dir, "Pods/Pods.xcodeproj"), { recursive: true });
    fs.writeFileSync(path.join(root, dir, "Pods/Pods.xcodeproj/project.pbxproj"), projectFixture("Pods-TomoTV"));
    fs.mkdirSync(path.join(root, dir, "TomoTV.xcworkspace"));
  }
  const env = { ...process.env, NODE_PATH: path.resolve("node_modules") };
  if (process.platform !== "darwin") {
    // The production script uses macOS sed. Translate only its in-place flag
    // so Linux CI can exercise the real workspace generator too.
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "sed"), '#!/bin/sh\nif [ "$1" = -i ] && [ "$2" = "" ]; then shift 2; exec /usr/bin/sed -i "$@"; fi\nexec /usr/bin/sed "$@"\n', { mode: 0o755 });
    env.PATH = `${bin}:${env.PATH}`;
  }
  const previous = new Map();
  for (let run = 0; run < 2; run++) {
    const result = spawnSync("bash", ["scripts/make-dual-workspace.sh", "--all"], { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const workspace = fs.readFileSync(path.join(root, "TomoTV.xcworkspace/contents.xcworkspacedata"), "utf8");
    assert.ok(workspace.indexOf("ios/TomoTV-iOS.xcodeproj") < workspace.indexOf("macos/TomoTV-macOS.xcodeproj"));
    assert.ok(workspace.indexOf("macos/TomoTV-macOS.xcodeproj") < workspace.indexOf("tvos/TomoTV-tvOS.xcodeproj"));
    for (const [dir, suffix] of Object.entries(platforms)) {
      assert.ok(workspace.includes(`${dir}/TomoTV-${suffix}.xcodeproj`));
      assert.ok(workspace.includes(`${dir}/Pods/Pods-${suffix}.xcodeproj`));
      const scheme = path.join(root, dir, `TomoTV-${suffix}.xcodeproj/xcshareddata/xcschemes/TomoTV-${suffix}.xcscheme`);
      assert.ok(fs.readFileSync(scheme, "utf8").includes(`container:TomoTV-${suffix}.xcodeproj`));
      assert.ok(fs.readFileSync(scheme, "utf8").includes('buildImplicitDependencies="NO"'));
      const projectPath = path.join(root, dir, `TomoTV-${suffix}.xcodeproj/project.pbxproj`);
      const project = xcode.project(projectPath);
      project.parseSync();
      const objects = project.hash.project.objects;
      const dependencies = objects.PBXNativeTarget.CCCCCCCCCCCCCCCCCCCCCCCC.dependencies;
      assert.equal(dependencies.length, 1);
      const proxy = objects.PBXContainerItemProxy[objects.PBXTargetDependency[dependencies[0].value].targetProxy];
      assert.equal(proxy.remoteGlobalIDString, "CCCCCCCCCCCCCCCCCCCCCCCC");
      assert.equal(objects.PBXFileReference[proxy.containerPortal].path, `"Pods/Pods-${suffix}.xcodeproj"`);
      const contents = fs.readFileSync(projectPath, "utf8");
      if (run) assert.equal(contents, previous.get(dir), "repeated workspace generation must not duplicate dependencies");
      previous.set(dir, contents);
    }
    assert.ok(!workspace.includes("TomoTV-Mac."));
  }
});
