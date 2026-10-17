const { withBuildProperties } = require("expo-build-properties");
const withMacCatalyst = require("../../plugins/withMacCatalyst");
const { expo } = require("../../app.json");
const { usePrecompiledModules } = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties")[1].ios;
const buildProperties = { ios: { usePrecompiledModules } };
const podfileContents = `target 'TomoTV' do
  config = use_native_modules!(config_command)
  post_install do |installer|
    react_native_post_install(
      installer,
      :mac_catalyst_enabled => false
    )
  end
end
`;
const compilationCache = `ReactNativePodsUtils.set_build_setting(installer, build_setting: "COMPILATION_CACHE_ENABLE_CACHING", value: "YES")`;

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
    const podfile = await input.mods.ios.podfile({ ...input, modResults: { contents: podfileContents }, modRequest: {} });
    expect(podfile.modResults.contents).toContain("config_command += ['--source-dir', __dir__]");
    expect(podfile.modResults.contents.indexOf("'--source-dir'")).toBeLessThan(podfile.modResults.contents.indexOf("use_native_modules!(config_command)"));
    expect(podfile.modResults.contents).toContain(":mac_catalyst_enabled => false");
    const again = await input.mods.ios.podfile({ ...input, modResults: podfile.modResults, modRequest: {} });
    expect(again.modResults.contents).toBe(podfile.modResults.contents);
  });
  it("hides iOS-on-Mac without changing iPhone, iPad, or Vision settings", async () => {
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
    const podfile = await c.mods.ios.podfile({ ...c, modResults: { contents: podfileContents }, modRequest: {} });
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
  it.each([
    ["iPhone and iPad", "0", "0"],
    ["tvOS", "0", "1"],
    ["Mac Catalyst", "1", "0"],
  ])("builds Expo modules from source on %s", async (_, mac, tv) => {
    process.env.EXPO_MACCATALYST = mac;
    process.env.EXPO_TV = tv;
    const c = withBuildProperties(withMacCatalyst(structuredClone(expo)), buildProperties);
    const result = await c.mods.ios.podfileProperties({ ...c, modResults: {}, modRequest: {} });
    expect(result.modResults.EXPO_USE_PRECOMPILED_MODULES).toBe("false");
  });
  it.each([
    ["iPhone and iPad", "0", "0"],
    ["tvOS", "0", "1"],
    ["Mac Catalyst", "1", "0"],
  ])("turns on Xcode compilation caching once inside post_install on %s", async (_, mac, tv) => {
    process.env.EXPO_MACCATALYST = mac;
    process.env.EXPO_TV = tv;
    const c = withMacCatalyst(structuredClone(expo));
    const podfile = await c.mods.ios.podfile({ ...c, modResults: { contents: podfileContents }, modRequest: {} });
    const contents = podfile.modResults.contents;
    expect(contents.indexOf(compilationCache)).toBeGreaterThan(contents.indexOf("post_install do |installer|"));
    expect(contents.indexOf(compilationCache)).toBeLessThan(contents.indexOf("react_native_post_install("));
    const again = await c.mods.ios.podfile({ ...c, modResults: podfile.modResults, modRequest: {} });
    expect(again.modResults.contents.split(compilationCache)).toHaveLength(2);
  });
  it("fails loudly when the Podfile has no post_install hook", async () => {
    process.env.EXPO_MACCATALYST = "0";
    process.env.EXPO_TV = "1";
    const c = withMacCatalyst(structuredClone(expo));
    await expect(c.mods.ios.podfile({ ...c, modResults: { contents: "config = use_native_modules!(config_command)" }, modRequest: {} })).rejects.toThrow(/post_install/);
  });
  it("writes the Catalyst Podfile hooks once", async () => {
    expect(expo.plugins[0]).toBe("./plugins/withMacCatalyst");
    const c = withBuildProperties(config(), buildProperties);
    const podfile = await c.mods.ios.podfile({
      ...c,
      modResults: { contents: podfileContents },
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
