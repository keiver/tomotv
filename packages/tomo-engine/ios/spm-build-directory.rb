# CocoaPods must generate both TomoEngine's build directory and its consumers' module-map,
# library and Swift import paths in SwiftPM's shared directory. Otherwise Xcode stages
# SpatialAudioCore twice and its archive signature records collide.
module TomoEngineSPMBuildDirectory
  def configuration_build_dir(dir = Pod::Target::BuildSettings::CONFIGURATION_BUILD_DIR_VARIABLE)
    pod_name == 'TomoEngine' ? dir : super
  end
end

Pod::PodTarget.prepend(TomoEngineSPMBuildDirectory)

# CocoaPods hardcodes the Swift module-map import path instead of using the target's directory.
module TomoEngineSPMModuleMap
  def module_map_file_to_import
    original = super
    return original unless target.pod_name == 'TomoEngine' && target.uses_swift? && original

    "#{target.configuration_build_dir}/#{target.product_module_name}.modulemap"
  end
end

Pod::Target::BuildSettings::PodTargetSettings.prepend(TomoEngineSPMModuleMap)

# Xcode stages the dynamic SpatialAudioCore.framework beside the static TomoEngine pod and embeds
# it nowhere: CocoaPods' embed phase copies and signs it into the app.
module TomoEngineSpatialAudioCore
  def framework_paths
    paths = super
    return paths unless pod_name == 'TomoEngine'

    core = Pod::Xcode::FrameworkPaths.new('${BUILT_PRODUCTS_DIR}/SpatialAudioCore.framework')
    paths.merge(pod_name => (paths[pod_name] || []) | [core])
  end
end

Pod::PodTarget.prepend(TomoEngineSpatialAudioCore)
