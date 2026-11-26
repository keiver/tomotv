/** The FileAttributes Swift module (native/ios/FileAttributes): file flags JavaScript cannot set. */

const { withNativeModuleFiles } = require("./nativeModuleFiles");

const MODULE_FILES = ["FileAttributes.swift", "FileAttributes.m"];

function withFileAttributes(config) {
  return withNativeModuleFiles(config, "FileAttributes", MODULE_FILES);
}

module.exports = withFileAttributes;
module.exports.MODULE_FILES = MODULE_FILES;
