// swift-tools-version: 6.0
import PackageDescription

// Host-side test package for the local remux engine. Not part of the app build:
// plugins/withMultiAudioResourceLoader.js copies sources by explicit name.
let ffmpeg = [
    "Libavcodec", "Libavformat", "Libavutil", "Libswresample",
    "Libswscale", "Libavfilter", "Libdav1d", "Libuavs3d", "Libass", "Mbedtls",
]

let package = Package(
    name: "TomoEngine",
    platforms: [.macOS(.v14)],
    products: [.library(name: "TomoEngine", targets: ["TomoEngine"])],
    targets: [
        .target(
            name: "TomoEngine",
            dependencies: ffmpeg.map { .byName(name: $0) },
            path: "LocalRemuxer",
            // The app target compiles in Swift 5 mode; the package must match it
            // or it tests code under rules the shipped build never applies.
            exclude: ["LocalRemuxer.swift", "LocalRemuxer.m"],
            sources: [
                "Remuxer.swift",
                "AudioTranscoder.swift",
                "VideoTranscoder.swift",
                "ImageSubtitleDecoder.swift",
                "TierRewrapper.swift",
                "PlaylistShim.swift",
                "LocalHTTPServer.swift",
                "EnginePlan.swift",
                "DolbyVisionConverter.swift",
                "FrameGrabber.swift",
                "PNGWriter.swift",
            ],
            swiftSettings: [.swiftLanguageMode(.v5)],
            // Same set the app links, measured by `nm -u` across the archives
            // and recorded in TomoFFmpeg.podspec. Keep the two in step.
            linkerSettings: [
                .linkedLibrary("iconv"),
                .linkedLibrary("z"),
                .linkedFramework("AudioToolbox"),
                .linkedFramework("VideoToolbox"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("CoreFoundation"),
                .linkedFramework("CoreText"),
                .linkedFramework("Metal"),
            ]
        ),
        .testTarget(
            name: "TomoEngineTests",
            // The FFmpeg modules too: Swift does not re-export a dependency's
            // imports, so a test touching AVStream/AVPacket needs them directly.
            dependencies: ["TomoEngine"] + ffmpeg.map { .byName(name: $0) },
            path: "Tests/TomoEngineTests",
            // Fixtures live beside the tests and are read by path, not bundled.
            exclude: ["../Fixtures"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ] + ffmpeg.map { .binaryTarget(name: $0, path: "Frameworks/\($0).xcframework") }
)
