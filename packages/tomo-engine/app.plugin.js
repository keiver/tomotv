/**
 * Expo config plugin: adds the TomoEngine, TomoLiveSources and TomoFFmpeg pods to the generated
 * ios/Podfile. The podspecs live in this package's ios/ directory, outside the app's ios/, so
 * `expo prebuild --clean` never deletes the engine sources or the fetched frameworks.
 */

const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PODS = ["TomoEngine", "TomoLiveSources", "TomoFFmpeg"];

function packageIosDir(projectRoot) {
  const manifest = require.resolve("@keiver/tomo-engine/package.json", { paths: [projectRoot] });
  return path.join(fs.realpathSync(path.dirname(manifest)), "ios");
}

/** Returns the Podfile text with both pod lines under use_expo_modules!, or the same text when they are present. */
function addEnginePods(podfile, podsPath) {
  const missing = PODS.filter((name) => !podfile.includes(`pod '${name}'`));
  if (missing.length === 0) return podfile;
  const lines = missing.map((name) => `  pod '${name}', :path => '${podsPath}'`).join("\n");
  const updated = podfile.replace(/^(\s*use_expo_modules!.*)$/m, `$1\n${lines}`);
  if (updated === podfile) {
    throw new Error("[tomo-engine] Could not find use_expo_modules! in Podfile to anchor the engine pods.");
  }
  return updated;
}

function withTomoEngine(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const iosDir = packageIosDir(projectRoot);

      if (!fs.existsSync(path.join(iosDir, "Frameworks", "Libavformat.xcframework", "Info.plist"))) {
        throw new Error("[tomo-engine] FFmpeg frameworks missing: run `npm rebuild @keiver/tomo-engine` before prebuild.");
      }

      const podfilePath = path.join(projectRoot, "ios", "Podfile");
      const podfile = fs.readFileSync(podfilePath, "utf8");
      const podsPath = path.relative(path.dirname(podfilePath), iosDir);
      const updated = addEnginePods(podfile, podsPath);
      if (updated !== podfile) {
        fs.writeFileSync(podfilePath, updated);
        console.log(`[tomo-engine] ✓ engine pods added to Podfile (${podsPath})`);
      } else {
        console.log("[tomo-engine] engine pods already in Podfile");
      }
      return config;
    },
  ]);
}

module.exports = withTomoEngine;
module.exports.addEnginePods = addEnginePods;
