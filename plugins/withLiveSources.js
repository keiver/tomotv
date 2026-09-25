/**
 * withLiveSources.js
 *
 * Expo config plugin for the LiveSources Swift module (native/ios/LiveSources): XMLTV guides, M3U
 * playlists and Jellyfin tuner groups. Copies the sources into the generated ios/ project and
 * registers them for compilation. libxml2 and zlib come from the TomoFFmpeg pod, which links both.
 */

const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Single source of truth: these are both copied into ios/ and added to the Xcode project.
const MODULE_FILES = [
  "Gunzip.swift",
  "SourceLoader.swift",
  "XmltvParser.swift",
  "GuideStore.swift",
  "GuideLoader.swift",
  "M3uParser.swift",
  "PlaylistStore.swift",
  "TunerGroups.swift",
  "JellyfinChannelId.swift",
  "MemoryFootprint.swift",
  "LiveSources.swift",
  "LiveSources.m",
];

function withLiveSources(config) {
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const sourcePath = path.join(projectRoot, "native", "ios", "LiveSources");
      const destPath = path.join(projectRoot, "ios", "LiveSources");

      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }

      console.log("[LiveSources] Copying module files...");
      MODULE_FILES.forEach((fileName) => {
        const source = path.join(sourcePath, fileName);
        if (fs.existsSync(source)) {
          fs.copyFileSync(source, path.join(destPath, fileName));
          console.log(`[LiveSources] ✓ Copied ${fileName}`);
        } else {
          console.warn(`[LiveSources] ⚠️  ${fileName} not found in native/ios/LiveSources`);
        }
      });

      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    MODULE_FILES.forEach((fileName) => {
      const filePath = `LiveSources/${fileName}`;
      const existingFile = xcodeProject.pbxFileReferenceSection();
      const alreadyAdded = Object.values(existingFile).some((file) => file.path && file.path.includes(fileName));

      if (!alreadyAdded) {
        console.log(`[LiveSources] Adding ${fileName} to Xcode project`);
        xcodeProject.addSourceFile(filePath, {}, xcodeProject.getFirstProject().firstProject.mainGroup);
      } else {
        console.log(`[LiveSources] ${fileName} already in project`);
      }
    });

    return config;
  });

  return config;
}

module.exports = withLiveSources;
