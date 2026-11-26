/**
 * Copies one native module's sources from native/ios/<name> into the generated ios/<name>
 * and adds them to the Xcode project. A file listed here and missing on disk stops the prebuild.
 */

const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withNativeModuleFiles(config, name, files) {
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const sourcePath = path.join(projectRoot, "native", "ios", name);
      const destPath = path.join(projectRoot, "ios", name);

      fs.mkdirSync(destPath, { recursive: true });
      files.forEach((fileName) => {
        const source = path.join(sourcePath, fileName);
        if (!fs.existsSync(source)) {
          throw new Error(`[${name}] ${fileName} not found in native/ios/${name}`);
        }
        fs.copyFileSync(source, path.join(destPath, fileName));
        console.log(`[${name}] ✓ Copied ${fileName}`);
      });

      return config;
    },
  ]);

  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    files.forEach((fileName) => {
      const references = xcodeProject.pbxFileReferenceSection();
      const alreadyAdded = Object.values(references).some((file) => file.path && file.path.includes(fileName));
      if (alreadyAdded) return;
      xcodeProject.addSourceFile(`${name}/${fileName}`, {}, xcodeProject.getFirstProject().firstProject.mainGroup);
      console.log(`[${name}] Added ${fileName} to the Xcode project`);
    });

    return config;
  });
}

module.exports = { withNativeModuleFiles };
