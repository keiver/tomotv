require 'minitest/autorun'
require 'cocoapods'
require_relative '../ios/spm-build-directory'

class SPMBuildDirectoryTest < Minitest::Test
  def target(name, framework: false)
    pod = Pod::PodTarget.allocate
    { pod_name: name, label: name, product_module_name: name, should_build?: true,
      build_as_framework?: framework, defines_module?: true, uses_swift?: true }.each do |method, value|
      pod.define_singleton_method(method) { value }
    end
    pod
  end

  def module_map(pod)
    settings = Pod::Target::BuildSettings::PodTargetSettings.new(pod, configuration: 'Release')
    settings.module_map_file_to_import
  end

  def test_engine_products_and_imports_share_the_swiftpm_directory
    engine = target('TomoEngine')
    assert_equal '${PODS_CONFIGURATION_BUILD_DIR}', engine.configuration_build_dir
    assert_equal 'shared path', engine.configuration_build_dir('shared path')
    assert_equal '${PODS_CONFIGURATION_BUILD_DIR}/TomoEngine.modulemap', module_map(engine)
  end

  def test_other_pods_keep_their_directories_and_imports
    other = target('Other')
    assert_equal 'shared path/Other', other.configuration_build_dir('shared path')
    assert_equal '${PODS_CONFIGURATION_BUILD_DIR}/Other/Other.modulemap', module_map(other)
  end

  def test_frameworks_keep_automatic_module_map_discovery
    assert_nil module_map(target('TomoEngine', framework: true))
  end

  def test_the_app_embeds_the_spatial_audio_core_once
    core = Pod::Xcode::FrameworkPaths.new('${BUILT_PRODUCTS_DIR}/SpatialAudioCore.framework')
    engine = target('TomoEngine')
    engine.instance_variable_set(:@framework_paths, { 'TomoEngine' => [core], 'TomoEngine/Tests' => [] })
    assert_equal({ 'TomoEngine' => [core], 'TomoEngine/Tests' => [] }, engine.framework_paths)
    engine.instance_variable_set(:@framework_paths, {})
    assert_equal({ 'TomoEngine' => [core] }, engine.framework_paths)
    other = target('Other')
    other.instance_variable_set(:@framework_paths, {})
    assert_equal({}, other.framework_paths)
  end
end
