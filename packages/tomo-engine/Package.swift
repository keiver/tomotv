// swift-tools-version: 6.0
import PackageDescription

// Host-side test package for the engine. The app builds the same sources as the
// TomoEngine pod (ios/TomoEngine.podspec); only the two React bridges stay out here.
let ffmpeg = [
    "Libavcodec", "Libavformat", "Libavutil", "Libswresample",
    "Libswscale", "Libavfilter", "Libdav1d", "Libuavs3d", "Libass", "Mbedtls", "Libzvbi",
]

let package = Package(
    name: "TomoEngine",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "TomoEngine", targets: ["TomoEngine"]),
        .library(name: "TomoLiveSources", targets: ["TomoLiveSources"]),
        // Tomo's book reader links the archive library the TomoFFmpeg pod vendors.
        .library(name: "Libarchive", targets: ["Libarchive"]),
    ],
    targets: [
        // XMLTV on libxml2 SAX and zlib, M3U playlists. No UIKit outside the bridge.
        .target(
            name: "TomoLiveSources",
            path: "ios/LiveSources",
            exclude: ["LiveSources.swift", "LiveSources.m"],
            swiftSettings: [.swiftLanguageMode(.v5)],
            linkerSettings: [.linkedLibrary("xml2"), .linkedLibrary("z")]
        ),
        .testTarget(
            name: "TomoLiveSourcesTests",
            dependencies: ["TomoLiveSources"],
            path: "Tests/TomoLiveSourcesTests",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // The app target compiles in Swift 5 mode; the package must match it
        // or it tests code under rules the shipped build never applies.
        .target(
            name: "TomoEngine",
            dependencies: ffmpeg.map { .byName(name: $0) },
            path: "ios/LocalRemuxer",
            exclude: ["LocalRemuxer.swift", "LocalRemuxer.m"],
            swiftSettings: [.swiftLanguageMode(.v5)],
            // Same set the app links, measured by `nm -u` across the archives
            // and recorded in ios/TomoFFmpeg.podspec. Keep the two in step.
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
            swiftSettings: [.swiftLanguageMode(.v5)],
            // LiveAVPlayerTests plays the engine's live output through the host's own AVPlayer.
            linkerSettings: [.linkedFramework("AVFoundation")]
        ),
    ] + (ffmpeg + ["Libarchive"]).map { .binaryTarget(name: $0, path: "ios/Frameworks/\($0).xcframework") }
)
