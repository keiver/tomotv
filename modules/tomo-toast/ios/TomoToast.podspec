Pod::Spec.new do |s|
  s.name           = 'TomoToast'
  s.version        = '1.0.0'
  s.summary        = 'Notification cards in their own window, above anything the app presents'
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
