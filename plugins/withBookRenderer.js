/**
 * withBookRenderer.js
 *
 * Expo config plugin for the BookRenderer Swift module (native/ios/BookRenderer): the
 * book reader's page renderer. Copies the sources into the generated ios/ project and
 * registers them for compilation. The bridging header and SWIFT_VERSION come from
 * withMultiAudioResourceLoader, which runs before this plugin in app.json; the
 * Libarchive framework it links comes from the TomoFFmpeg pod (withFFmpeg).
 */

const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Single source of truth: these are both copied into ios/ and added to the
// Xcode project. Keeping one list avoids a file being copied but never compiled.
const MODULE_FILES = [
  "BookError.swift",
  "BookArchive.swift",
  "BookRender.swift",
  "BookSource.swift",
  "ImageBook.swift",
  "PdfBook.swift",
  "EpubBook.swift",
  "MobiBook.swift",
  "HtmlText.swift",
  "TextPaginator.swift",
  "TextBook.swift",
  "BookRenderer.swift",
  "BookRenderer.m",
];

function withBookRenderer(config) {
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const sourcePath = path.join(projectRoot, "native", "ios", "BookRenderer");
      const destPath = path.join(projectRoot, "ios", "BookRenderer");

      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }

      console.log("[BookRenderer] Copying module files...");
      MODULE_FILES.forEach((fileName) => {
        const source = path.join(sourcePath, fileName);
        if (fs.existsSync(source)) {
          fs.copyFileSync(source, path.join(destPath, fileName));
          console.log(`[BookRenderer] ✓ Copied ${fileName}`);
        } else {
          console.warn(`[BookRenderer] ⚠️  ${fileName} not found in native/ios/BookRenderer`);
        }
      });

      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    MODULE_FILES.forEach((fileName) => {
      const filePath = `BookRenderer/${fileName}`;
      const existingFile = xcodeProject.pbxFileReferenceSection();
      const alreadyAdded = Object.values(existingFile).some((file) => file.path && file.path.includes(fileName));

      if (!alreadyAdded) {
        console.log(`[BookRenderer] Adding ${fileName} to Xcode project`);
        xcodeProject.addSourceFile(filePath, {}, xcodeProject.getFirstProject().firstProject.mainGroup);
      } else {
        console.log(`[BookRenderer] ${fileName} already in project`);
      }
    });

    return config;
  });

  return config;
}

module.exports = withBookRenderer;
