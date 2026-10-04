#
# TomoLiveSources.podspec
#
# The live sources module: XMLTV guides on libxml2 SAX and zlib, M3U playlists parsed
# natively, behind a legacy RCT_EXTERN_MODULE bridge. Its module name matches the
# Swift package product so an app's own Swift imports it the same way in both builds.
#
require "json"

package = JSON.parse(File.read(File.join(__dir__, "..", "package.json")))

Pod::Spec.new do |s|
  s.name         = "TomoLiveSources"
  s.version      = package["version"]
  s.summary      = "XMLTV guides and M3U playlists, loaded and parsed natively"
  s.homepage     = package["homepage"]
  s.license      = { :type => "MIT" }
  s.author       = package["author"]
  s.source       = { :path => "." }

  s.ios.deployment_target  = "15.1"
  s.tvos.deployment_target = "16.4"
  s.swift_versions = ["5.0"]

  s.source_files = "LiveSources/**/*.{swift,m}"

  s.dependency "React-Core"
  s.libraries = "xml2", "z"

  s.pod_target_xcconfig = { "DEFINES_MODULE" => "YES" }
end
