/**
 * withMacKeyCommands.js
 *
 * Installs the Mac key command controller as the app's root view controller.
 *
 * Key commands are collected from the first responder upwards, so the only
 * responder that can see a press no matter what has focus is the root view
 * controller. Expo's react delegate hands one out through createRootViewController
 * (ExpoReactNativeFactoryDelegate.swift), and its default handler returns nil, so
 * this app currently gets a bare UIViewController. This override swaps in ours,
 * and ONLY on a Mac: everywhere else it returns super's object untouched, so an
 * iPhone, an iPad and an Apple TV allocate exactly what they allocate today.
 *
 * The controller itself lives in native/ios/MultiAudioResourceLoader/MacKeyCommands.swift,
 * copied and compiled by withMultiAudioResourceLoader.js. Nothing but this override
 * goes into generated code.
 */

const { withAppDelegate } = require("@expo/config-plugins");

/** Insertion point: the class the generated file already marks for plugins. */
const ANCHOR = "class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {";

/** Present means a previous run already injected; the mod is then a no-op. */
const MARKER = "MacKeyCommandsViewController()";

const OVERRIDE = `
  // TomoTV: the root view controller is the one responder that is an ancestor of
  // every chain in the app, AVKit's inline player included. Mac only; off a Mac
  // this returns exactly what Expo returned before this plugin existed.
  override func createRootViewController() -> UIViewController {
    let base = super.createRootViewController()
#if os(iOS)
    if MacKeyCommands.isMacHost, type(of: base) == UIViewController.self {
      return MacKeyCommandsViewController()
    }
#endif
    return base
  }
`;

function withMacKeyCommands(config) {
  return withAppDelegate(config, (config) => {
    const { contents, language } = config.modResults;

    // Loud on purpose. A silent miss here ships a Mac build with no keyboard and
    // no sign of why, and the anchor is Expo template text that can move.
    if (language !== "swift") {
      throw new Error(`[withMacKeyCommands] Expected a Swift AppDelegate, found "${language}".`);
    }

    if (contents.includes(MARKER)) {
      console.log("[withMacKeyCommands] Root view controller override already present");
      return config;
    }

    if (!contents.includes(ANCHOR)) {
      throw new Error(`[withMacKeyCommands] Could not find "${ANCHOR}" in AppDelegate.swift. The Expo template changed; update the anchor.`);
    }

    config.modResults.contents = contents.replace(ANCHOR, `${ANCHOR}\n${OVERRIDE}`);
    console.log("[withMacKeyCommands] ✓ Root view controller override added");
    return config;
  });
}

module.exports = withMacKeyCommands;
