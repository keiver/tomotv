// Keep each scheme's dependency graph inside its own platform projects. iOS and
// Catalyst Pods have identical product names and cannot use workspace-wide lookup.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const xcode = require("xcode");

function linkPlatformPods(dir, suffix) {
  const appPath = path.join(dir, `TomoTV-${suffix}.xcodeproj/project.pbxproj`);
  const podsName = `Pods-${suffix}.xcodeproj`;
  const app = xcode.project(appPath);
  const pods = xcode.project(path.join(dir, "Pods", podsName, "project.pbxproj"));
  app.parseSync();
  pods.parseSync();
  const objects = app.hash.project.objects;
  const root = objects.PBXProject[app.hash.project.rootObject];
  const id = (name) => createHash("sha256").update(`TomoTV:${suffix}:${name}`).digest("hex").slice(0, 24).toUpperCase();
  const put = (section, uuid, value, comment) => {
    objects[section] ||= {};
    objects[section][uuid] = { isa: section, ...value };
    objects[section][`${uuid}_comment`] = comment;
  };
  const projectRef = id("pods-project");
  const products = id("pods-products");
  put("PBXFileReference", projectRef, { lastKnownFileType: '"wrapper.pb-project"', name: JSON.stringify(podsName), path: JSON.stringify(`Pods/${podsName}`), sourceTree: '"<group>"' }, podsName);
  if (!objects.PBXGroup[products]) put("PBXGroup", products, { children: [], name: "Products", sourceTree: '"<group>"' }, "Products");
  const children = objects.PBXGroup[root.mainGroup].children;
  if (!children.some((child) => child.value === projectRef)) children.push({ value: projectRef, comment: podsName });
  root.projectReferences ||= [];
  if (!root.projectReferences.some((ref) => ref.ProjectRef === projectRef)) root.projectReferences.push({ ProductGroup: products, ProjectRef: projectRef });

  let linked = 0;
  for (const [targetId, target] of Object.entries(objects.PBXNativeTarget)) {
    if (typeof target !== "object") continue;
    const name = String(target.name).replace(/^"|"$/g, "");
    const podName = `Pods-${name}`;
    const remote = Object.entries(pods.hash.project.objects.PBXNativeTarget).find(([, value]) => typeof value === "object" && String(value.name).replace(/^"|"$/g, "") === podName);
    if (!remote) {
      if (name === "TomoTV") throw new Error(`Missing ${podName} in ${dir}/Pods/${podsName}`);
      continue; // TopShelf has no Pods of its own; retain its existing dependency.
    }
    const proxy = id(`proxy:${targetId}`);
    const dependency = id(`dependency:${targetId}`);
    put(
      "PBXContainerItemProxy",
      proxy,
      { containerPortal: projectRef, containerPortal_comment: podsName, proxyType: 1, remoteGlobalIDString: remote[0], remoteInfo: JSON.stringify(podName) },
      "PBXContainerItemProxy",
    );
    put("PBXTargetDependency", dependency, { name: JSON.stringify(podName), targetProxy: proxy, targetProxy_comment: "PBXContainerItemProxy" }, "PBXTargetDependency");
    target.dependencies ||= [];
    if (!target.dependencies.some((entry) => entry.value === dependency)) target.dependencies.push({ value: dependency, comment: "PBXTargetDependency" });
    linked++;
  }
  if (!linked) throw new Error(`No application Pods dependency found in ${appPath}`);
  const output = app.writeSync();
  if (fs.readFileSync(appPath, "utf8") !== output) fs.writeFileSync(appPath, output);
  const schemePath = path.join(dir, `TomoTV-${suffix}.xcodeproj/xcshareddata/xcschemes/TomoTV-${suffix}.xcscheme`);
  const scheme = fs.readFileSync(schemePath, "utf8");
  const scoped = scheme.replace(/buildImplicitDependencies\s*=\s*"YES"/g, 'buildImplicitDependencies="NO"');
  if (!/buildImplicitDependencies\s*=\s*"NO"/.test(scoped)) throw new Error(`Missing BuildAction in ${schemePath}`);
  if (scoped !== scheme) fs.writeFileSync(schemePath, scoped);
}

if (require.main === module) linkPlatformPods(process.argv[2], process.argv[3]);
module.exports = { linkPlatformPods };
