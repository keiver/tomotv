const { withBuildProperties } = require("expo-build-properties");
const withMacCatalyst = require("../../plugins/withMacCatalyst");
const { expo } = require("../../app.json");

describe("Mac Catalyst prebuild", () => {
  const originalMac = process.env.EXPO_MACCATALYST;
  const originalTV = process.env.EXPO_TV;
  afterEach(() => {
    if (originalMac === undefined) delete process.env.EXPO_MACCATALYST;
    else process.env.EXPO_MACCATALYST = originalMac;
    if (originalTV === undefined) delete process.env.EXPO_TV;
    else process.env.EXPO_TV = originalTV;
  });
  const config = () => {
    process.env.EXPO_MACCATALYST = "1";
    process.env.EXPO_TV = "0";
    return withMacCatalyst(structuredClone(expo));
  };
  it("keeps tvOS autolinking in its final directory without changing its build settings", async () => {
    process.env.EXPO_MACCATALYST = "0";
    process.env.EXPO_TV = "1";
    const input = structuredClone(expo);
    expect(withMacCatalyst(input)).toBe(input);
    expect(input.mods.ios.xcodeproj).toBeUndefined();
    expect(input.mods.ios.podfileProperties).toBeUndefined();
    const podfile = await input.mods.ios.podfile({ ...input, modResults: { contents: "config = use_native_modules!(config_command)" }, modRequest: {} });
    expect(podfile.modResults.contents).toContain("config_command += ['--source-dir', __dir__]");
    expect(podfile.modResults.contents.indexOf("'--source-dir'")).toBeLessThan(podfile.modResults.contents.indexOf("use_native_modules!(config_command)"));
    expect(podfile.modResults.contents).not.toContain("mac_catalyst_enabled");
    const again = await input.mods.ios.podfile({ ...input, modResults: podfile.modResults, modRequest: {} });
    expect(again.modResults.contents).toBe(podfile.modResults.contents);
  });
  it("hides iOS-on-Mac without changing iPhone, iPad, Vision, or iOS precompiled module settings", async () => {
    process.env.EXPO_MACCATALYST = "0";
    process.env.EXPO_TV = "0";
    const c = withMacCatalyst(structuredClone(expo));
    const settings = { SDKROOT: "iphoneos", TARGETED_DEVICE_FAMILY: '"1,2"', SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD: "YES", SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD: "YES" };
    const configurations = Object.fromEntries(["Debug", "Release"].map((name) => [name, { name, buildSettings: { ...settings } }]));
    const project = {
      getFirstTarget: () => ({ firstTarget: { buildConfigurationList: "app" } }),
      pbxXCConfigurationList: () => ({ app: { buildConfigurations: [{ value: "Debug" }, { value: "Release" }] } }),
      pbxXCBuildConfigurationSection: () => configurations,
    };
    await c.mods.ios.xcodeproj({ ...c, modResults: project, modRequest: {} });
    for (const { buildSettings } of Object.values(configurations)) {
      expect(buildSettings).toEqual({ ...settings, SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD: "NO" });
    }
    expect(c.ios).toEqual(expo.ios);
    expect(c.mods.ios.podfileProperties).toBeUndefined();
    const podfile = await c.mods.ios.podfile({ ...c, modResults: { contents: "target 'TomoTV' do\n  config = use_native_modules!(config_command)\nend\n" }, modRequest: {} });
    expect(podfile.modResults.contents).toContain("config_command += ['--source-dir', __dir__]");
    expect(podfile.modResults.contents).toContain("require_relative '../scripts/prebuilt-swift-imports'");
    expect(podfile.modResults.contents).toContain("TomoPrebuiltSwiftImports.apply(installer)");
    const again = await c.mods.ios.podfile({ ...c, modResults: podfile.modResults, modRequest: {} });
    expect(again.modResults.contents).toBe(podfile.modResults.contents);
  });
  it("rejects combining tvOS and Catalyst", () => {
    process.env.EXPO_MACCATALYST = "1";
    process.env.EXPO_TV = "1";
    expect(() => withMacCatalyst({})).toThrow(/cannot be enabled together/);
  });
  it("exposes Mac through Catalyst without a native macOS destination that rejects iOS storyboards", async () => {
    const c = config();
    const configurations = Object.fromEntries(
      ["Debug", "Release"].map((name) => [
        name,
        { name, buildSettings: { SDKROOT: "iphoneos", SUPPORTED_PLATFORMS: '"iphoneos iphonesimulator macosx"', TARGETED_DEVICE_FAMILY: '"1,2"', SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD: "YES" } },
      ]),
    );
    const project = {
      getFirstTarget: () => ({ firstTarget: { buildConfigurationList: "app" } }),
      pbxXCConfigurationList: () => ({ app: { buildConfigurations: [{ value: "Debug" }, { value: "Release" }] } }),
      pbxXCBuildConfigurationSection: () => configurations,
    };
    await c.mods.ios.xcodeproj({ ...c, modResults: project, modRequest: {} });
    for (const { buildSettings } of Object.values(configurations)) {
      expect(buildSettings.SUPPORTS_MACCATALYST).toBe("YES");
      expect(buildSettings.SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD).toBe("NO");
      expect(buildSettings.SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD).toBe("NO");
      expect(buildSettings.SUPPORTED_PLATFORMS).toBe('"iphoneos iphonesimulator"');
      expect(buildSettings.SDKROOT).toBe("iphoneos");
      expect(buildSettings.TARGETED_DEVICE_FAMILY).toBe('"1,2"');
    }
  });
  it("uses automatic signing without requiring a named Mac profile", async () => {
    const c = config();
    const configurations = Object.fromEntries(
      ["Debug", "Release"].map((name) => [
        name,
        { name, buildSettings: { CODE_SIGN_STYLE: "Manual", PROVISIONING_PROFILE: "old-profile", PROVISIONING_PROFILE_SPECIFIER: "TomoTV Mac App Store", DEVELOPMENT_TEAM: expo.ios.appleTeamId } },
      ]),
    );
    const project = {
      getFirstTarget: () => ({ firstTarget: { buildConfigurationList: "app" } }),
      pbxXCConfigurationList: () => ({ app: { buildConfigurations: [{ value: "Debug" }, { value: "Release" }] } }),
      pbxXCBuildConfigurationSection: () => configurations,
    };
    await c.mods.ios.xcodeproj({ ...c, modResults: project, modRequest: {} });
    for (const { buildSettings } of Object.values(configurations)) {
      expect(buildSettings.CODE_SIGN_STYLE).toBe("Automatic");
      expect(buildSettings.PROVISIONING_PROFILE).toBeUndefined();
      expect(buildSettings.PROVISIONING_PROFILE_SPECIFIER).toBeUndefined();
      expect(buildSettings.DEVELOPMENT_TEAM).toBe(expo.ios.appleTeamId);
    }
  });
  it("keeps Expo modules built from source after other plugins run", async () => {
    expect(expo.plugins[0]).toBe("./plugins/withMacCatalyst");
    const c = withBuildProperties(config(), {});
    const result = await c.mods.ios.podfileProperties({ ...c, modResults: {}, modRequest: {} });
    expect(result.modResults.EXPO_USE_PRECOMPILED_MODULES).toBe("false");
    const podfile = await c.mods.ios.podfile({
      ...c,
      modResults: { contents: "config = use_native_modules!(config_command)\nreact_native_post_install(\n  installer,\n  :mac_catalyst_enabled => false\n)" },
      modRequest: {},
    });
    expect(podfile.modResults.contents).toContain("config_command += ['--source-dir', __dir__]");
    expect(podfile.modResults.contents.indexOf("'--source-dir'")).toBeLessThan(podfile.modResults.contents.indexOf("use_native_modules!(config_command)"));
    expect(podfile.modResults.contents).toContain(":mac_catalyst_enabled => true");
    expect(podfile.modResults.contents).toContain("settings['MACOSX_DEPLOYMENT_TARGET']");
    expect(podfile.modResults.contents).toContain("Gem::Version.new('13.4')");
    expect(podfile.modResults.contents).toContain("settings['IPHONEOS_DEPLOYMENT_TARGET[sdk=macosx*]']");
    expect(podfile.modResults.contents).toContain("post_integrate do |installer|");
    expect(podfile.modResults.contents).toContain("require_relative '../scripts/catalyst-frameworks'");
    expect(podfile.modResults.contents).toContain("TomoCatalystFrameworks.patch_embed_script(target.embed_frameworks_script_path)");
    const again = await c.mods.ios.podfile({ ...c, modResults: podfile.modResults, modRequest: {} });
    expect(again.modResults.contents).toBe(podfile.modResults.contents);
  });
  it("preserves keychain groups while sandboxing outbound and loopback networking", async () => {
    const c = config();
    const input = { "keychain-access-groups": ["$(AppIdentifierPrefix)dev.keiver.tomotv"] };
    const result = await c.mods.ios.entitlements({ ...c, modResults: input, modRequest: {} });
    expect(result.modResults).toEqual({
      ...input,
      "com.apple.security.app-sandbox": true,
      "com.apple.security.network.client": true,
      "com.apple.security.network.server": true,
    });
  });
});
