/**
 * withTunerGroups.js
 *
 * Expo config plugin for the TunerGroups Swift module (native/ios/TunerGroups): a Jellyfin M3U
 * tuner's groups and channel ids, read through the engine's TomoLiveSources pod. Copies the
 * sources into the generated ios/ project and registers them for compilation.
 */

const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Single source of truth: these are both copied into ios/ and added to the Xcode project.
const MODULE_FILES = ["JellyfinChannelId.swift", "TunerGroups.swift", "TunerGroupsModule.swift", "TunerGroups.m"];

function withTunerGroups(config) {
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const sourcePath = path.join(projectRoot, "native", "ios", "TunerGroups");
      const destPath = path.join(projectRoot, "ios", "TunerGroups");

      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }

      console.log("[TunerGroups] Copying module files...");
      MODULE_FILES.forEach((fileName) => {
        const source = path.join(sourcePath, fileName);
        if (fs.existsSync(source)) {
          fs.copyFileSync(source, path.join(destPath, fileName));
          console.log(`[TunerGroups] ✓ Copied ${fileName}`);
        } else {
          console.warn(`[TunerGroups] ⚠️  ${fileName} not found in native/ios/TunerGroups`);
        }
      });

      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    MODULE_FILES.forEach((fileName) => {
      const filePath = `TunerGroups/${fileName}`;
      const existingFile = xcodeProject.pbxFileReferenceSection();
      const alreadyAdded = Object.values(existingFile).some((file) => file.path && file.path.includes(fileName));

      if (!alreadyAdded) {
        console.log(`[TunerGroups] Adding ${fileName} to Xcode project`);
        xcodeProject.addSourceFile(filePath, {}, xcodeProject.getFirstProject().firstProject.mainGroup);
      } else {
        console.log(`[TunerGroups] ${fileName} already in project`);
      }
    });

    return config;
  });

  return config;
}

module.exports = withTunerGroups;
