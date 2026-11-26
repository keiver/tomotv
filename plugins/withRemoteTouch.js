/** The RemoteTouch Swift module (native/ios/RemoteTouch): two touches on the Apple TV remote's surface. */

const { withNativeModuleFiles } = require("./nativeModuleFiles");

const MODULE_FILES = ["RemoteTouch.swift", "RemoteTouch.m"];

function withRemoteTouch(config) {
  return withNativeModuleFiles(config, "RemoteTouch", MODULE_FILES);
}

module.exports = withRemoteTouch;
module.exports.MODULE_FILES = MODULE_FILES;
