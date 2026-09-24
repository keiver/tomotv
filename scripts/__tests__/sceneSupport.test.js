const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { withBuildProperties } = require("expo-build-properties");
const withMacKeyCommands = require("../../plugins/withMacKeyCommands");
const { expo } = require("../../app.json");

function sceneConfig() {
  const plugin = expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === "expo-build-properties");
  expect(plugin?.[1]?.ios?.enableSceneSupport).toBe(true);
  return withBuildProperties({ ...structuredClone(expo), _internal: { projectRoot: path.resolve(__dirname, "../..") } }, plugin[1]);
}

describe("UIKit scene support", () => {
  it("declares Expo's scene delegate without removing the app's existing plist settings", async () => {
    const config = sceneConfig();
    const result = await config.mods.ios.infoPlist({ ...config, modResults: structuredClone(expo.ios.infoPlist), modRequest: {} });

    expect(result.modResults).toMatchObject(expo.ios.infoPlist);
    expect(result.modResults.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: "EXExpoAppSceneDelegate" }],
      },
    });
  });

  it("moves template startup to the scene delegate and preserves Mac key commands and linking", async () => {
    const template = execFileSync("tar", ["-xOf", path.join(path.dirname(require.resolve("expo/package.json")), "template.tgz"), "package/ios/HelloWorld/AppDelegate.swift"], {
      encoding: "utf8",
    });
    const config = withMacKeyCommands(sceneConfig());
    const result = await config.mods.ios.appDelegate({ ...config, modResults: { language: "swift", contents: template }, modRequest: {} });
    const contents = result.modResults.contents;

    expect(contents).toContain("class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {");
    expect(contents).toContain("reactNativeFactory = factory");
    expect(contents).not.toContain("window = UIWindow(frame:");
    expect(contents).not.toContain("factory.startReactNative(");
    expect(contents).toContain("return MacKeyCommandsViewController()");
    expect(contents).toContain("RCTLinkingManager.application(app, open: url, options: options)");
    expect(contents).toContain("RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)");
  });
});
