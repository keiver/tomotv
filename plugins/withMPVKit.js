/**
 * withMPVKit.js
 *
 * Expo config plugin that injects the TomoFFmpeg pod (FFmpeg static
 * xcframeworks from MPVKit, see native/ios/TomoFFmpeg.podspec) into the
 * generated ios/Podfile.
 *
 * The pod is referenced by :path outside ios/, so `expo prebuild --clean`
 * regenerating ios/ never deletes the frameworks; this plugin only has to
 * re-add the one Podfile line each prebuild.
 */

const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const POD_LINE = "  pod 'TomoFFmpeg', :path => '../native/ios'";

function withMPVKit(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;

      const frameworksDir = path.join(projectRoot, "native", "ios", "Frameworks");
      if (!fs.existsSync(path.join(frameworksDir, "Libavformat.xcframework", "Info.plist"))) {
        throw new Error("[withMPVKit] FFmpeg frameworks missing — run `npm run fetch:mpvkit` before prebuild.");
      }

      const podfilePath = path.join(projectRoot, "ios", "Podfile");
      const podfile = fs.readFileSync(podfilePath, "utf8");

      if (!podfile.includes("TomoFFmpeg")) {
        // Anchor on use_expo_modules! — first line inside the app target block
        const updated = podfile.replace(/^(\s*use_expo_modules!.*)$/m, `$1\n${POD_LINE}`);
        if (updated === podfile) {
          throw new Error("[withMPVKit] Could not find use_expo_modules! in Podfile to anchor the TomoFFmpeg pod.");
        }
        fs.writeFileSync(podfilePath, updated);
        console.log("[withMPVKit] ✓ TomoFFmpeg pod added to Podfile");
      } else {
        console.log("[withMPVKit] TomoFFmpeg pod already in Podfile");
      }

      return config;
    },
  ]);
}

module.exports = withMPVKit;
