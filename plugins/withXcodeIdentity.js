/**
 * withXcodeIdentity.js
 *
 * Expo config plugin that fills the app target's Identity section in Xcode after
 * prebuild. Expo writes the display name, version, and build number only into the
 * physical Info.plist; Xcode's General → Identity fields read the corresponding
 * BUILD SETTINGS, so they show empty (Display Name, App Category) or the template
 * defaults (Version 1.0) until set by hand. This stamps the build settings from
 * app.json so the UI and the shipped plist agree:
 *
 * - MARKETING_VERSION / CURRENT_PROJECT_VERSION ← ios.version / ios.buildNumber
 * - INFOPLIST_KEY_CFBundleDisplayName ← expo.name
 * - INFOPLIST_KEY_LSApplicationCategoryType ← ios.infoPlist.LSApplicationCategoryType
 *
 * Only the first native target (the app) is touched — the TopShelf extension sets
 * its own versions in withTopShelfExtension.
 *
 * Created: August 4, 2026
 */

const { withXcodeProject } = require("@expo/config-plugins");

function withXcodeIdentity(config) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    const marketingVersion = (config.ios && config.ios.version) || config.version;
    const buildNumber = (config.ios && config.ios.buildNumber) || "1";
    const displayName = config.name;
    const category = config.ios && config.ios.infoPlist && config.ios.infoPlist.LSApplicationCategoryType;

    const appTarget = xcodeProject.getFirstTarget();
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    const configList = xcodeProject.pbxXCConfigurationList()[appTarget.firstTarget.buildConfigurationList];

    configList.buildConfigurations.forEach((entry) => {
      const buildConfig = configurations[entry.value];
      if (!buildConfig || !buildConfig.buildSettings) return;
      const settings = buildConfig.buildSettings;
      settings.MARKETING_VERSION = marketingVersion;
      settings.CURRENT_PROJECT_VERSION = buildNumber;
      // pbxproj values with spaces or hyphens must be quoted explicitly.
      settings.INFOPLIST_KEY_CFBundleDisplayName = `"${displayName}"`;
      if (category) {
        settings.INFOPLIST_KEY_LSApplicationCategoryType = `"${category}"`;
      }
      console.log(`[XcodeIdentity] ✓ Identity settings applied (${buildConfig.name})`);
    });

    return config;
  });
}

module.exports = withXcodeIdentity;
