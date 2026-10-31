/**
 * withSubtitleSearch.js
 *
 * Expo config plugin for the SubtitleSearch Swift module (native/ios/SubtitleSearch): the tvOS
 * subtitle panel presented over the player. Copies the sources into the generated ios/ project
 * and registers them for compilation.
 */

const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Single source of truth: these are both copied into ios/ and added to the Xcode project.
const MODULE_FILES = ["SubtitlePanelState.swift", "SubtitleSearchPanelViewController.swift", "SubtitleSearchModule.swift", "SubtitleSearch.m"];

function withSubtitleSearch(config) {
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const sourcePath = path.join(projectRoot, "native", "ios", "SubtitleSearch");
      const destPath = path.join(projectRoot, "ios", "SubtitleSearch");

      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }

      console.log("[SubtitleSearch] Copying module files...");
      MODULE_FILES.forEach((fileName) => {
        const source = path.join(sourcePath, fileName);
        if (fs.existsSync(source)) {
          fs.copyFileSync(source, path.join(destPath, fileName));
          console.log(`[SubtitleSearch] ✓ Copied ${fileName}`);
        } else {
          console.warn(`[SubtitleSearch] ⚠️  ${fileName} not found in native/ios/SubtitleSearch`);
        }
      });

      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    MODULE_FILES.forEach((fileName) => {
      const filePath = `SubtitleSearch/${fileName}`;
      const existingFile = xcodeProject.pbxFileReferenceSection();
      const alreadyAdded = Object.values(existingFile).some((file) => file.path && file.path.includes(fileName));

      if (!alreadyAdded) {
        console.log(`[SubtitleSearch] Adding ${fileName} to Xcode project`);
        xcodeProject.addSourceFile(filePath, {}, xcodeProject.getFirstProject().firstProject.mainGroup);
      } else {
        console.log(`[SubtitleSearch] ${fileName} already in project`);
      }
    });

    return config;
  });

  return config;
}

module.exports = withSubtitleSearch;
