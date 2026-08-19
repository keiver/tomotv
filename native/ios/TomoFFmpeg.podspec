#
# TomoFFmpeg.podspec
#
# Vendors the FFmpeg static xcframeworks the LocalRemuxer links against. The
# frameworks live in Frameworks/ next to this file, downloaded by
# scripts/fetch-ffmpeg.js (gitignored, ~187MB unpacked).
#
# Built by scripts/ffmpeg/build.sh and published by CI. 497 decoders.
#
# The pod is injected into ios/Podfile by plugins/withFFmpeg.js during prebuild
# with `:path => '../native/ios'`, so it survives `expo prebuild --clean`.
#
Pod::Spec.new do |s|
  s.name         = "TomoFFmpeg"
  s.version      = "1.0.0"
  s.summary      = "FFmpeg (LGPL) for Tomo TV's local remux engine"
  s.homepage     = "https://github.com/keiver/tomotv"
  s.license      = { :type => "LGPL-3.0", :text => "See app/licenses.tsx and constants/licenses.ts" }
  s.author       = "Keiver"
  s.source       = { :path => "." }

  s.ios.deployment_target  = "15.1"
  s.tvos.deployment_target = "16.4"

  # In sync with scripts/ffmpeg/build.sh and ffmpeg-lock.json.
  # Libdav1d exports its API as tomo_dav1d_*, so it coexists with the libdav1d
  # pod expo-image links for AVIF instead of cross-wiring with it.
  # NAMES are load-bearing: FFmpeg headers include each other as
  # `libavutil/avutil.h`, which resolves only as a framework include matched
  # case-insensitively. Libass and Mbedtls each carry their private deps merged in.
  frameworks = %w[
    Libavformat Libavcodec Libavutil Libswresample Libswscale Libavfilter
    Libdav1d Libuavs3d Libass Mbedtls
  ]
  missing = frameworks.reject { |f| File.exist?(File.join(__dir__, "Frameworks", "#{f}.xcframework", "Info.plist")) }
  unless missing.empty?
    raise "[TomoFFmpeg] Missing #{missing.join(', ')} in native/ios/Frameworks — run `npm run fetch:ffmpeg` first."
  end

  s.vendored_frameworks = frameworks.map { |f| "Frameworks/#{f}.xcframework" }

  # MEASURED, not assumed: `nm -u` across every archive minus what the set
  # defines. zlib/bzip2/lzma/libxml2/Security are absent from it, so they are
  # absent here. CoreText is libass's font lookup, Metal is yadif_videotoolbox.
  s.libraries  = "iconv"
  s.frameworks = "AudioToolbox", "VideoToolbox", "CoreMedia", "CoreVideo", "CoreFoundation", "CoreText", "Metal"
end
