const { withDangerousMod, withEntitlementsPlist, withInfoPlist, withPodfile, withPodfileProperties, withXcodeProject } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

/** Mac uses the dedicated Catalyst project. iOS/tvOS retain their Pods. */
function withMacCatalyst(config) {
  const catalyst = process.env.EXPO_MACCATALYST === "1";
  if (process.env.EXPO_TV === "1") {
    if (catalyst) throw new Error("Mac Catalyst and tvOS cannot be enabled together.");
    return config;
  }
  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const target = project.getFirstTarget().firstTarget;
    const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
    for (const entry of list.buildConfigurations) {
      // Hide the iOS-on-Mac destination in both projects; Mac builds use Catalyst.
      // This controls Xcode destinations, not App Store Connect availability.
      project.pbxXCBuildConfigurationSection()[entry.value].buildSettings.SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = "NO";
    }
    return config;
  });
  if (!catalyst) return config;
  config.ios = { ...config.ios, usePrecompiledModules: false };

  config = withPodfileProperties(config, (config) => {
    config.modResults.EXPO_USE_PRECOMPILED_MODULES = "false";
    return config;
  });
  config = withPodfile(config, (config) => {
    const autolinking = "config = use_native_modules!(config_command)";
    if (!config.modResults.contents.includes("# TomoTV Catalyst autolinking root")) {
      if (!config.modResults.contents.includes(autolinking)) throw new Error("Catalyst: cannot locate Expo's native module autolinking call.");
      config.modResults.contents = config.modResults.contents.replace(
        autolinking,
        `# TomoTV Catalyst autolinking root: pod install runs after ios/ moves to macos/.
  config_command += ['--source-dir', __dir__] if config_command.include?('expo-modules-autolinking')
  ${autolinking}`,
      );
    }
    const pattern = /:mac_catalyst_enabled\s*=>\s*(?:false|true)/;
    if (!pattern.test(config.modResults.contents)) throw new Error("Catalyst: Expo's react_native_post_install hook changed.");
    config.modResults.contents = config.modResults.contents.replace(pattern, ":mac_catalyst_enabled => true");
    if (!config.modResults.contents.includes("# TomoTV Catalyst deployment targets")) {
      const hook = /react_native_post_install\([\s\S]*?^\s*\)/m;
      if (!hook.test(config.modResults.contents)) throw new Error("Catalyst: cannot locate the end of react_native_post_install.");
      config.modResults.contents = config.modResults.contents.replace(
        hook,
        (call) => `${call}
    # TomoTV Catalyst deployment targets: CocoaPods otherwise defaults to macOS 10.15.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        settings = build_config.build_settings
        settings['MACOSX_DEPLOYMENT_TARGET'] = [Gem::Version.new(settings['MACOSX_DEPLOYMENT_TARGET'] || '0'), Gem::Version.new('13.4')].max.to_s
        settings['IPHONEOS_DEPLOYMENT_TARGET[sdk=macosx*]'] = [Gem::Version.new(settings['IPHONEOS_DEPLOYMENT_TARGET'] || '0'), Gem::Version.new('16.5')].max.to_s
      end
    end`,
      );
    }
    return config;
  });
  config = withEntitlementsPlist(config, (config) => {
    Object.assign(config.modResults, {
      "com.apple.security.app-sandbox": true,
      "com.apple.security.network.client": true,
      // The remux engine serves AVPlayer over 127.0.0.1.
      "com.apple.security.network.server": true,
    });
    return config;
  });
  config = withInfoPlist(config, (config) => {
    // Retain the iPad idiom and existing single-window React root.
    config.modResults.UISupportsTrueScreenSizeOnMac = true;
    return config;
  });
  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const target = project.getFirstTarget().firstTarget;
    const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
    for (const entry of list.buildConfigurations) {
      const buildConfig = project.pbxXCBuildConfigurationSection()[entry.value];
      Object.assign(buildConfig.buildSettings, {
        CODE_SIGN_STYLE: "Automatic",
        SUPPORTS_MACCATALYST: "YES",
        // Xcode adds macosx for Catalyst. Listing it here also exposes native Mac builds,
        // which compile the iOS storyboard with --target-device mac and fail.
        SUPPORTED_PLATFORMS: '"iphoneos iphonesimulator"',
        DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER: "NO",
        MACOSX_DEPLOYMENT_TARGET: "13.4",
        '"IPHONEOS_DEPLOYMENT_TARGET[sdk=macosx*]"': "16.5",
        '"ARCHS[sdk=macosx*]"': '"arm64 x86_64"',
        ENABLE_HARDENED_RUNTIME: "YES",
      });
      delete buildConfig.buildSettings.PROVISIONING_PROFILE;
      delete buildConfig.buildSettings.PROVISIONING_PROFILE_SPECIFIER;
      if (buildConfig.name === "Release") buildConfig.buildSettings.ONLY_ACTIVE_ARCH = "NO";
    }
    return config;
  });
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const sharp = require("sharp");
      const root = config.modRequest.platformProjectRoot;
      const icon = path.join(root, "TomoTV", "Images.xcassets", "AppIcon.appiconset");
      const contentsPath = path.join(icon, "Contents.json");
      const contents = JSON.parse(fs.readFileSync(contentsPath, "utf8"));
      const original = contents.images.find((image) => image.filename && !image.appearances && image.idiom !== "mac");
      if (!original) throw new Error("Catalyst: no generated app icon to derive the Mac icons from.");
      contents.images = contents.images.filter((image) => image.idiom !== "mac");
      for (const size of [16, 32, 128, 256, 512]) {
        for (const scale of [1, 2]) {
          const filename = `mac-${size}@${scale}x.png`;
          await sharp(path.join(icon, original.filename))
            .resize(size * scale, size * scale)
            .png()
            .toFile(path.join(icon, filename));
          contents.images.push({ idiom: "mac", size: `${size}x${size}`, scale: `${scale}x`, filename });
        }
      }
      fs.writeFileSync(contentsPath, `${JSON.stringify(contents, null, 2)}\n`);
      return config;
    },
  ]);
}

module.exports = withMacCatalyst;
