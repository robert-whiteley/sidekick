Pod::Spec.new do |s|
  s.name           = 'SidekickNative'
  s.version        = '1.0.0'
  s.summary        = 'Sidekick on-device engines'
  s.description    = 'Sidekick on-device engines (LLM, speech)'
  s.author         = 'Sidekick contributors'
  s.homepage       = 'https://github.com/robert-whiteley/sidekick'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
