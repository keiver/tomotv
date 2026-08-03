/**
 * withTopShelfExtension.js
 *
 * Expo config plugin that adds the tvOS Top Shelf app-extension target (dynamic
 * "Continue Watching" shelf on the Apple TV home screen).
 *
 * - Copies native/ios/TopShelf/ (ContentProvider.swift, TopShelf-Info.plist,
 *   TopShelf.entitlements) into ios/TopShelf/
 * - Creates the "TopShelf" app_extension target. xcode's addTarget also creates the
 *   .appex product, the embed Copy Files phase on the app target, and the target
 *   dependency — only the Sources phase and build settings are added here.
 *
 * tvOS-only: skipped entirely unless EXPO_TV=1 (iOS builds get no extension).
 *
 * Created: August 3, 2026
 */

const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const TARGET_NAME = "TopShelf";
const BUNDLE_ID = "dev.keiver.tomotv.TopShelf";
const EXTENSION_FILES = ["ContentProvider.swift", "TopShelf-Info.plist", "TopShelf.entitlements"];

function isTVBuild() {
  return process.env.EXPO_TV === "1";
}

/**
 * Expo config plugin to add the Top Shelf extension target.
 * @param {Object} config - Expo config object
 * @returns {Object} Modified config object
 */
function withTopShelfExtension(config) {
  // Step 1: Copy extension sources from native/ios/TopShelf to ios/TopShelf
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      if (!isTVBuild()) {
        console.log("[TopShelf] Skipped (non-TV build).");
        return config;
      }

      const projectRoot = config.modRequest.projectRoot;
      const sourceDir = path.join(projectRoot, "native", "ios", TARGET_NAME);
      const destDir = path.join(projectRoot, "ios", TARGET_NAME);

      console.log("[TopShelf] Copying Top Shelf extension files...");
      fs.mkdirSync(destDir, { recursive: true });
      EXTENSION_FILES.forEach((fileName) => {
        const sourcePath = path.join(sourceDir, fileName);
        if (!fs.existsSync(sourcePath)) {
          throw new Error(`[TopShelf] Missing ${fileName} in native/ios/${TARGET_NAME}`);
        }
        fs.copyFileSync(sourcePath, path.join(destDir, fileName));
        console.log(`[TopShelf] ✓ Copied ${fileName}`);
      });

      return config;
    },
  ]);

  // Step 2: Create the extension target and wire its build phases/settings
  config = withXcodeProject(config, (config) => {
    if (!isTVBuild()) {
      return config;
    }

    const xcodeProject = config.modResults;

    console.log("\n" + "=".repeat(80));
    console.log("[TopShelf] Configuring Top Shelf extension target");
    console.log("=".repeat(80));

    // Idempotency: prebuild --clean regenerates the project, but guard anyway.
    // addTarget stores the name quoted, so check both spellings.
    if (xcodeProject.pbxTargetByName(TARGET_NAME) || xcodeProject.pbxTargetByName(`"${TARGET_NAME}"`)) {
      console.log("[TopShelf] Target already exists, skipping.");
      return config;
    }

    // xcode's addTargetDependency silently no-ops unless these sections already exist
    // (pbxProject.js:860), and Expo's single-target project has neither — without them
    // the app would embed a stale .appex instead of rebuilding the extension first.
    const objects = xcodeProject.hash.project.objects;
    objects["PBXTargetDependency"] = objects["PBXTargetDependency"] || {};
    objects["PBXContainerItemProxy"] = objects["PBXContainerItemProxy"] || {};

    // Creates target + configs (INFOPLIST_FILE = TopShelf/TopShelf-Info.plist), the
    // .appex product, the embed Copy Files phase on the app target, and the dependency.
    const target = xcodeProject.addTarget(TARGET_NAME, "app_extension", TARGET_NAME, BUNDLE_ID);
    console.log("[TopShelf] ✓ Target created");

    xcodeProject.addBuildPhase([`${TARGET_NAME}/ContentProvider.swift`], "PBXSourcesBuildPhase", "Sources", target.uuid);
    console.log("[TopShelf] ✓ Sources build phase added");

    // Read DEVELOPMENT_TEAM off the app target so automatic signing covers the
    // extension without a manual Xcode step (best-effort — may be unset locally).
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    let developmentTeam;
    Object.values(configurations).forEach((buildConfig) => {
      if (buildConfig && buildConfig.buildSettings && buildConfig.buildSettings.DEVELOPMENT_TEAM) {
        developmentTeam = buildConfig.buildSettings.DEVELOPMENT_TEAM;
      }
    });

    // Only touch the new target's own build configurations, never the app's.
    const marketingVersion = config.version ?? "1.0.0";
    const buildNumber = (config.ios && config.ios.buildNumber) || "1";
    const configList = xcodeProject.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
    configList.buildConfigurations.forEach((entry) => {
      const buildConfig = configurations[entry.value];
      if (!buildConfig || !buildConfig.buildSettings) return;
      const settings = buildConfig.buildSettings;
      settings.CODE_SIGN_ENTITLEMENTS = `${TARGET_NAME}/${TARGET_NAME}.entitlements`;
      // withMultiAudioResourceLoader sets the app's bridging header on the PROJECT-level
      // configs, which this target would inherit — override to none (pure-Swift target,
      // React headers are not in its search paths).
      settings.SWIFT_OBJC_BRIDGING_HEADER = '""';
      settings.SWIFT_VERSION = "5.0";
      settings.TVOS_DEPLOYMENT_TARGET = "16.4";
      settings.TARGETED_DEVICE_FAMILY = "3";
      settings.SDKROOT = "appletvos";
      settings.MARKETING_VERSION = marketingVersion;
      settings.CURRENT_PROJECT_VERSION = buildNumber;
      settings.GENERATE_INFOPLIST_FILE = "NO";
      if (developmentTeam) {
        settings.DEVELOPMENT_TEAM = developmentTeam;
      }
      console.log(`[TopShelf] ✓ Build settings applied (${buildConfig.name})`);
    });

    console.log("[TopShelf] ✅ Top Shelf extension configured");
    console.log("=".repeat(80) + "\n");

    return config;
  });

  return config;
}

module.exports = withTopShelfExtension;
