/**
 * withLyricsListener.js
 *
 * Expo config plugin for the LyricsListener Swift module (native/ios/LyricsListener): the
 * system's on-device transcriber run over a song. Copies the sources into the generated ios/
 * project and registers them for compilation. Speech.framework links weakly on its own, every
 * symbol used being newer than the deployment target.
 */

const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Single source of truth: these are both copied into ios/ and added to the Xcode project.
const MODULE_FILES = ["LyricsListener.swift", "LyricsListenerModule.swift", "LyricsListener.m"];

function withLyricsListener(config) {
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const sourcePath = path.join(projectRoot, "native", "ios", "LyricsListener");
      const destPath = path.join(projectRoot, "ios", "LyricsListener");

      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }

      console.log("[LyricsListener] Copying module files...");
      MODULE_FILES.forEach((fileName) => {
        const source = path.join(sourcePath, fileName);
        if (fs.existsSync(source)) {
          fs.copyFileSync(source, path.join(destPath, fileName));
          console.log(`[LyricsListener] ✓ Copied ${fileName}`);
        } else {
          console.warn(`[LyricsListener] ⚠️  ${fileName} not found in native/ios/LyricsListener`);
        }
      });

      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    MODULE_FILES.forEach((fileName) => {
      const filePath = `LyricsListener/${fileName}`;
      const existingFile = xcodeProject.pbxFileReferenceSection();
      const alreadyAdded = Object.values(existingFile).some((file) => file.path && file.path.includes(fileName));

      if (!alreadyAdded) {
        console.log(`[LyricsListener] Adding ${fileName} to Xcode project`);
        xcodeProject.addSourceFile(filePath, {}, xcodeProject.getFirstProject().firstProject.mainGroup);
      } else {
        console.log(`[LyricsListener] ${fileName} already in project`);
      }
    });

    return config;
  });

  return config;
}

module.exports = withLyricsListener;
