// swift-tools-version: 6.0
import PackageDescription

// Host-side test package for the local remux engine. Not part of the app build:
// plugins/withMultiAudioResourceLoader.js copies sources by explicit name.
let ffmpeg = [
    "Libavcodec", "Libavformat", "Libavutil", "Libswresample",
    "Libswscale", "Libavfilter", "Libdav1d", "Libuavs3d", "Libass", "Mbedtls", "Libzvbi",
]

let package = Package(
    name: "TomoEngine",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "TomoEngine", targets: ["TomoEngine"]),
        .library(name: "TomoBooks", targets: ["TomoBooks"]),
    ],
    targets: [
        // The book reader's page renderer (plugins/withBookRenderer.js copies the same
        // files into the app). No UIKit outside the bridge, so it tests on the host.
        .target(
            name: "TomoBooks",
            dependencies: ["Libarchive"],
            path: "BookRenderer",
            exclude: ["BookRenderer.swift", "BookRenderer.m"],
            swiftSettings: [.swiftLanguageMode(.v5)],
            linkerSettings: [
                .linkedLibrary("iconv"),
                .linkedLibrary("z"),
                .linkedLibrary("bz2"),
                .linkedFramework("CoreText"),
                .linkedFramework("ImageIO"),
                .linkedFramework("CoreGraphics"),
            ]
        ),
        .testTarget(
            name: "TomoBooksTests",
            dependencies: ["TomoBooks"],
            path: "Tests/TomoBooksTests",
            exclude: ["../Fixtures"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .target(
            name: "TomoEngine",
            dependencies: ffmpeg.map { .byName(name: $0) },
            path: "LocalRemuxer",
            // The app target compiles in Swift 5 mode; the package must match it
            // or it tests code under rules the shipped build never applies.
            exclude: ["LocalRemuxer.swift", "LocalRemuxer.m"],
            sources: [
                "EngineLog.swift",
                "RemuxTypes.swift",
                "Remuxer.swift",
                "RemuxSession+Grid.swift",
                "RemuxSession+Lifecycle.swift",
                "RemuxSession+Playlists.swift",
                "RemuxSession+Tier.swift",
                "RemuxSession+AudioLo.swift",
                "RemuxSession+Segments.swift",
                "RemuxSession+Routes.swift",
                "RemuxSession+ServerSubtitles.swift",
                "RemuxSession+LinkProbe.swift",
                "RemuxSession+Pipeline.swift",
                "AudioTranscoder.swift",
                "VideoTranscoder.swift",
                "DeviceDecode.swift",
                "ImageSubtitleDecoder.swift",
                "TextSubtitleDecoder.swift",
                "AssToWebVTT.swift",
                "TierRewrapper.swift",
                "PlaylistShim.swift",
                "InitSegmentSdr.swift",
                "LocalHTTPServer.swift",
                "EndpointProbe.swift",
                "EnginePlan.swift",
                "DolbyVisionConverter.swift",
                "FrameGrabber.swift",
                "ImageWriter.swift",
                "PosterQueue.swift",
            ],
            swiftSettings: [.swiftLanguageMode(.v5)],
            // Same set the app links, measured by `nm -u` across the archives
            // and recorded in TomoFFmpeg.podspec. Keep the two in step.
            linkerSettings: [
                .linkedLibrary("iconv"),
                .linkedLibrary("z"),
                .linkedLibrary("xml2"),
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
            swiftSettings: [.swiftLanguageMode(.v5)],
            // LiveAVPlayerTests plays the engine's live output through the host's own AVPlayer.
            linkerSettings: [.linkedFramework("AVFoundation")]
        ),
    ] + (ffmpeg + ["Libarchive"]).map { .binaryTarget(name: $0, path: "Frameworks/\($0).xcframework") }
)
