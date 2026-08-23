/**
 * withAudioQueuePlayer.js
 *
 * Expo config plugin for the AudioQueuePlayer Swift module (native music-style
 * queue player: AVQueuePlayer + presented AVPlayerViewController).
 *
 * Copies the module sources from native/ios/AudioQueuePlayer into the generated
 * ios/ project and registers them for compilation. The bridging header and
 * SWIFT_VERSION are already configured globally by withMultiAudioResourceLoader
 * (which must run before this plugin in app.json), so no build-settings work
 * happens here.
 */

const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Single source of truth: these are both copied into ios/ and added to the
// Xcode project. Keeping one list avoids a file being copied but never compiled.
const MODULE_FILES = ["AudioQueuePlayer.swift", "NowPlayingCoordinator.swift", "UpNextPanelViewController.swift", "AudioArtworkOverlayView.swift", "AudioQueuePlayer.m"];

function withAudioQueuePlayer(config) {
  // Step 1: Copy module files from native/ios to the generated ios directory
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const sourcePath = path.join(projectRoot, "native", "ios", "AudioQueuePlayer");
      const destPath = path.join(projectRoot, "ios", "AudioQueuePlayer");

      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }

      console.log("[AudioQueuePlayer] Copying module files...");
      MODULE_FILES.forEach((fileName) => {
        const source = path.join(sourcePath, fileName);
        if (fs.existsSync(source)) {
          fs.copyFileSync(source, path.join(destPath, fileName));
          console.log(`[AudioQueuePlayer] ✓ Copied ${fileName}`);
        } else {
          console.warn(`[AudioQueuePlayer] ⚠️  ${fileName} not found in native/ios/AudioQueuePlayer`);
        }
      });

      return config;
    },
  ]);

  // Step 2: Register the files in the Xcode project
  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    MODULE_FILES.forEach((fileName) => {
      const filePath = `AudioQueuePlayer/${fileName}`;
      const existingFile = xcodeProject.pbxFileReferenceSection();
      const alreadyAdded = Object.values(existingFile).some((file) => file.path && file.path.includes(fileName));

      if (!alreadyAdded) {
        console.log(`[AudioQueuePlayer] Adding ${fileName} to Xcode project`);
        xcodeProject.addSourceFile(filePath, {}, xcodeProject.getFirstProject().firstProject.mainGroup);
      } else {
        console.log(`[AudioQueuePlayer] ${fileName} already in project`);
      }
    });

    return config;
  });

  return config;
}

module.exports = withAudioQueuePlayer;
