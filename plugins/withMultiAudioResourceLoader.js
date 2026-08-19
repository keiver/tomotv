/**
 * withMultiAudioResourceLoader.js
 *
 * Expo config plugin for integrating MultiAudioResourceLoader Swift module.
 *
 * This plugin automatically:
 * - Adds Swift files to Xcode project
 * - Configures bridging header
 * - Sets up build settings
 *
 * No manual Xcode steps required!
 *
 * Created: January 23, 2026
 */

const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Single source of truth: these are both copied into ios/ and added to the Xcode
// project. Keeping one list avoids a file being copied but never compiled.
const MODULE_FILES = [
  "MultiAudioResourceLoader.swift",
  "RNVideoPlugin.swift",
  "HLSManifestParser.swift",
  "HLSManifestGenerator.swift",
  "NetworkInfo.swift",
  "DeviceEnvironment.swift",
  "MacKeyCommands.swift",
  "MultiAudioResourceLoader.m",
  "NetworkInfo.m",
  "DeviceEnvironment.m",
  "MacKeyCommands.m",
  "MultiAudioResourceLoader-Bridging-Header.h",
];

// The local remux engine (native/ios/LocalRemuxer) rides the same copy +
// addSourceFile machinery; its FFmpeg dependency comes from the TomoFFmpeg pod
// that plugins/withFFmpeg.js adds to the Podfile.
const REMUXER_FILES = [
  "Remuxer.swift",
  "AudioTranscoder.swift",
  "VideoTranscoder.swift",
  "ImageSubtitleDecoder.swift",
  "TierRewrapper.swift",
  "PlaylistShim.swift",
  "LocalHTTPServer.swift",
  "EnginePlan.swift",
  "LocalRemuxer.swift",
  "LocalRemuxer.m",
];

/**
 * Expo config plugin to set up MultiAudioResourceLoader
 * @param {Object} config - Expo config object
 * @returns {Object} Modified config object
 */
function withMultiAudioResourceLoader(config) {
  // Step 1: Copy Swift files from native/ios to ios directory
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const iosPath = path.join(projectRoot, "ios");
      const modulePath = path.join(iosPath, "MultiAudioResourceLoader");
      const sourceModulePath = path.join(projectRoot, "native", "ios", "MultiAudioResourceLoader");

      // Ensure the MultiAudioResourceLoader directory exists
      if (!fs.existsSync(modulePath)) {
        console.log("[MultiAudioResourceLoader] Creating MultiAudioResourceLoader directory...");
        fs.mkdirSync(modulePath, { recursive: true });
      }

      console.log("[MultiAudioResourceLoader] Copying Swift module files...");
      const copyInto = (files, sourceDir, destDir, label) => {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        files.forEach((fileName) => {
          const sourcePath = path.join(sourceDir, fileName);
          if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, path.join(destDir, fileName));
            console.log(`[MultiAudioResourceLoader] ✓ Copied ${fileName}`);
          } else {
            console.warn(`[MultiAudioResourceLoader] ⚠️  ${fileName} not found in ${label}`);
          }
        });
      };

      copyInto(MODULE_FILES, sourceModulePath, modulePath, "native/ios/MultiAudioResourceLoader");
      copyInto(REMUXER_FILES, path.join(projectRoot, "native", "ios", "LocalRemuxer"), path.join(iosPath, "LocalRemuxer"), "native/ios/LocalRemuxer");

      return config;
    },
  ]);

  // Step 2: Add files to Xcode project and configure bridging header
  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    console.log("\n" + "=".repeat(80));
    console.log("[MultiAudioResourceLoader] Configuring Xcode Project");
    console.log("=".repeat(80));

    // Headers are copied but never added to the target: a .h in the Sources build
    // phase is dead weight (Xcode skips it), and the bridging header is located
    // through SWIFT_OBJC_BRIDGING_HEADER below, not through a project reference.
    const compiledFiles = [...MODULE_FILES.filter((fileName) => !fileName.endsWith(".h")).map((f) => `MultiAudioResourceLoader/${f}`), ...REMUXER_FILES.map((f) => `LocalRemuxer/${f}`)];

    // Add files to project
    compiledFiles.forEach((filePath) => {
      const fileName = path.basename(filePath);

      // Check if file already exists in project
      const existingFile = xcodeProject.pbxFileReferenceSection();
      const alreadyAdded = Object.values(existingFile).some((file) => file.path && file.path.includes(fileName));

      if (!alreadyAdded) {
        console.log(`[MultiAudioResourceLoader] Adding ${fileName} to Xcode project`);

        // Add file to project (this will add it to the main group automatically)
        const file = xcodeProject.addSourceFile(filePath, {}, xcodeProject.getFirstProject().firstProject.mainGroup);

        if (file) {
          console.log(`[MultiAudioResourceLoader] ✓ ${fileName} added successfully`);
        }
      } else {
        console.log(`[MultiAudioResourceLoader] ${fileName} already in project`);
      }
    });

    // Configure bridging header in build settings
    // IMPORTANT: Must wrap in quotes because of $(PROJECT_DIR) syntax
    const bridgingHeaderPath = '"$(PROJECT_DIR)/MultiAudioResourceLoader/MultiAudioResourceLoader-Bridging-Header.h"';

    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    Object.keys(configurations).forEach((key) => {
      const config = configurations[key];
      if (config.buildSettings && !config.name) {
        // Skip summary entries
        return;
      }
      if (config.buildSettings) {
        // The TopShelf extension target (plugins/withTopShelfExtension.js) is pure Swift with
        // no React dependency — the app's bridging header would break its build (React headers
        // aren't in its search paths). Order-independent guard: identify its configs by plist.
        if (String(config.buildSettings.INFOPLIST_FILE || "").includes("TopShelf")) {
          console.log(`[MultiAudioResourceLoader] Skipping bridging header for extension config ${config.name || "config"}`);
          return;
        }
        console.log(`[MultiAudioResourceLoader] Setting bridging header for ${config.name || "config"}`);
        config.buildSettings.SWIFT_OBJC_BRIDGING_HEADER = bridgingHeaderPath;

        // Ensure Swift version is set
        if (!config.buildSettings.SWIFT_VERSION) {
          config.buildSettings.SWIFT_VERSION = "5.0";
        }
      }
    });

    console.log("[MultiAudioResourceLoader] ✅ Xcode project configured successfully");
    console.log("=".repeat(80) + "\n");

    return config;
  });

  return config;
}

module.exports = withMultiAudioResourceLoader;
