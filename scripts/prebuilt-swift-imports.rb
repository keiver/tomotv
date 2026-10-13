# CocoaPods emits source-module include paths even for framework-only pods.
# A stale .swiftmodule there shadows the XCFramework's Swift interface, so
# callers compile against a different ABI from the binary linked into the app.
module TomoPrebuiltSwiftImports
  def self.apply(installer)
    framework_pods = installer.pods_project.targets.select do |target|
      target.isa == 'PBXAggregateTarget' && target.build_phases.any? { |phase| phase.display_name == '[CP] Copy XCFrameworks' }
    end.map(&:name)
    patch_search_paths(installer.sandbox.root, framework_pods)
  end

  def self.patch_search_paths(pods_root, framework_pods)
    return if framework_pods.empty?

    # Match only the obsolete source-module directory, not XCFrameworkIntermediates
    # or source-built dependencies. Accept both Xcode variable spellings.
    names = Regexp.union(framework_pods)
    source_path = /\$(?:\{PODS_CONFIGURATION_BUILD_DIR\}|\(PODS_CONFIGURATION_BUILD_DIR\))\/(?:#{names})/
    entry = /[ \t]+(?:"#{source_path}"|#{source_path}(?=[ \t]|$))/
    Dir.glob(File.join(pods_root, 'Target Support Files', '**', '*.xcconfig')).each do |path|
      original = File.read(path)
      updated = original.gsub(/^(SWIFT_INCLUDE_PATHS(?:\[[^\]\n]+\])*[ \t]*=)([^\n]*)$/) do
        "#{Regexp.last_match(1)}#{Regexp.last_match(2).gsub(entry, '')}"
      end
      File.write(path, updated) unless updated == original
    end
  end
end
