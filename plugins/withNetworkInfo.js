/** The NetworkInfo Swift module (native/ios/NetworkInfo): the device's own IPv4 address and netmask. */

const { withNativeModuleFiles } = require("./nativeModuleFiles");

const MODULE_FILES = ["NetworkInfo.swift", "NetworkInfo.m"];

function withNetworkInfo(config) {
  return withNativeModuleFiles(config, "NetworkInfo", MODULE_FILES);
}

module.exports = withNetworkInfo;
module.exports.MODULE_FILES = MODULE_FILES;
