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
  "MultiAudioResourceLoader.m",
  "NetworkInfo.m",
  "MultiAudioResourceLoader-Bridging-Header.h",
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
      MODULE_FILES.forEach((fileName) => {
        const sourcePath = path.join(sourceModulePath, fileName);
        const destPath = path.join(modulePath, fileName);

        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, destPath);
          console.log(`[MultiAudioResourceLoader] ✓ Copied ${fileName}`);
        } else {
          console.warn(`[MultiAudioResourceLoader] ⚠️  ${fileName} not found in native/ios/MultiAudioResourceLoader`);
        }
      });

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
    const compiledFiles = MODULE_FILES.filter((fileName) => !fileName.endsWith(".h"));

    // Add files to project
    compiledFiles.forEach((fileName) => {
      const filePath = `MultiAudioResourceLoader/${fileName}`;

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
