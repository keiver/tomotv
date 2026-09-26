Pod::Spec.new do |s|
  s.name           = 'TVMenuTrap'
  s.version        = '1.0.0'
  s.summary        = 'Conditional Menu-press trap for the tvOS guide'
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
