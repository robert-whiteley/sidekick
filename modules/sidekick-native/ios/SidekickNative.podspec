require 'digest'
require 'fileutils'

# Google LiteRT-LM (Apache-2.0) for the on-device chat model and memory search vectors. The Swift
# wrapper is vendored in LiteRTLM/ (same tag); the prebuilt C library (~96 MB zip) is fetched here at
# `pod install` time (on the EAS build machine), checked against its pinned SHA-256 and never
# committed. Keep the tag in step with the Android dependency in android/build.gradle (ADR 10).
LITERTLM_TAG = 'v0.20.0'
LITERTLM_ZIP_SHA256 = 'ae6b2b2ea3e46964152110ad5bd64b754f39273add2eb4cc417bbbbd72c5e6e7'

vendor_dir = File.join(__dir__, 'vendor')
xcframework = File.join(vendor_dir, 'CLiteRTLM.xcframework')
stamp = File.join(vendor_dir, "CLiteRTLM-#{LITERTLM_TAG}.ok")
unless File.exist?(stamp) && File.directory?(xcframework)
  FileUtils.rm_rf(vendor_dir)
  FileUtils.mkdir_p(vendor_dir)
  zip = File.join(vendor_dir, 'CLiteRTLM.xcframework.zip')
  url = "https://github.com/google-ai-edge/LiteRT-LM/releases/download/#{LITERTLM_TAG}/CLiteRTLM.xcframework.zip"
  system('curl', '-fsSL', '--retry', '3', '-o', zip, url) or raise "Could not download #{url}"
  actual = Digest::SHA256.file(zip).hexdigest
  raise "CLiteRTLM.xcframework.zip SHA-256 mismatch: #{actual}" unless actual == LITERTLM_ZIP_SHA256
  system('unzip', '-q', '-o', zip, '-d', vendor_dir) or raise 'Could not unzip CLiteRTLM.xcframework.zip'
  FileUtils.rm_f(zip)
  FileUtils.touch(stamp)
end

# Offline place names (GeoNames cities500, CC BY 4.0): the same pack the Android build ships,
# copied next to this podspec so CocoaPods can bundle it (it only takes files under the pod).
geo_src = File.join(__dir__, '..', 'android', 'src', 'main', 'assets', 'geo', 'places500.bin')
geo_dir = File.join(__dir__, 'Resources')
geo_dst = File.join(geo_dir, 'places500.bin')
if File.exist?(geo_src) && (!File.exist?(geo_dst) || File.size(geo_dst) != File.size(geo_src))
  FileUtils.mkdir_p(geo_dir)
  FileUtils.cp(geo_src, geo_dst)
end

Pod::Spec.new do |s|
  s.name           = 'SidekickNative'
  s.version        = '1.0.0'
  s.summary        = 'Sidekick on-device engines'
  s.description    = 'Sidekick on-device engines (LLM, memory search, speech, photo text)'
  s.author         = 'Sidekick contributors'
  s.homepage       = 'https://github.com/robert-whiteley/sidekick'
  s.license        = 'Apache-2.0'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }

  s.source_files = '*.swift', 'LiteRTLM/*.swift'
  s.vendored_frameworks = 'vendor/CLiteRTLM.xcframework'
  s.resource_bundles = { 'SidekickGeo' => ['Resources/places500.bin'] }
  s.frameworks = 'Speech', 'Vision', 'PDFKit', 'AVFoundation', 'ImageIO', 'CryptoKit'
end
