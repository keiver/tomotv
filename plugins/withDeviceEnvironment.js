/** The DeviceEnvironment Swift module (native/ios/DeviceEnvironment): which kind of host the app runs on. */

const { withNativeModuleFiles } = require("./nativeModuleFiles");

const MODULE_FILES = ["DeviceEnvironment.swift", "DeviceEnvironment.m"];

function withDeviceEnvironment(config) {
  return withNativeModuleFiles(config, "DeviceEnvironment", MODULE_FILES);
}

module.exports = withDeviceEnvironment;
module.exports.MODULE_FILES = MODULE_FILES;
