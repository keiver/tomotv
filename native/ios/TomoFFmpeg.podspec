#
# TomoFFmpeg.podspec
#
# Vendors the FFmpeg static xcframeworks (from MPVKit, LGPL build) that the
# LocalRemuxer links against. The frameworks live in Frameworks/ next to this
# file, downloaded by scripts/fetch-mpvkit.js (gitignored, ~350MB unpacked).
#
# The pod is injected into ios/Podfile by plugins/withMPVKit.js during prebuild
# with `:path => '../native/ios'`, so it survives `expo prebuild --clean`.
#
Pod::Spec.new do |s|
  s.name         = "TomoFFmpeg"
  s.version      = "1.0.0"
  s.summary      = "FFmpeg libraries (MPVKit LGPL build) for TomoTV's local remux engine"
  s.homepage     = "https://github.com/mpvkit/MPVKit"
  s.license      = { :type => "LGPL-3.0", :text => "See https://github.com/mpvkit/MPVKit" }
  s.author       = "MPVKit"
  s.source       = { :path => "." }

  s.ios.deployment_target  = "15.1"
  s.tvos.deployment_target = "16.4"

  # Kept in sync with FRAMEWORKS in scripts/fetch-mpvkit.js. The four FFmpeg
  # libraries are what LocalRemuxer imports; the rest are the transitive
  # dependencies their static archives leave undefined at link time.
  frameworks = %w[
    Libavformat Libavcodec Libavutil Libswresample
    gnutls nettle hogweed gmp lcms2 Libdav1d Libuavs3d
  ]
  missing = frameworks.reject { |f| File.exist?(File.join(__dir__, "Frameworks", "#{f}.xcframework", "Info.plist")) }
  unless missing.empty?
    raise "[TomoFFmpeg] Missing #{missing.join(', ')} in native/ios/Frameworks — run `npm run fetch:mpvkit` first."
  end

  s.vendored_frameworks = frameworks.map { |f| "Frameworks/#{f}.xcframework" }

  # The vendored frameworks are static archives; their undefined symbols must be
  # satisfied when the app links. System libraries FFmpeg's build references:
  s.libraries  = "z", "bz2", "iconv", "lzma", "xml2"
  s.frameworks = "AudioToolbox", "VideoToolbox", "CoreMedia", "CoreVideo", "CoreFoundation", "Security"
end
