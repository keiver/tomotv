Pod::Spec.new do |s|
  s.name           = 'LiveClip'
  s.version        = '1.0.0'
  s.summary        = 'Muted looping preview clip for Live TV channel cards'
  s.license        = 'MIT'
  s.author         = 'Keiver'
  s.homepage       = 'https://keiver.dev'
  s.platforms      = { :ios => '16.4', :tvos => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
