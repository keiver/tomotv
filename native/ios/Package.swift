// swift-tools-version: 6.0
import PackageDescription

// Host-side test package for Tomo's own native modules. The engine's package is
// packages/tomo-engine; it also supplies the Libarchive xcframework linked here.
let package = Package(
    name: "TomoBooks",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "TomoBooks", targets: ["TomoBooks"]),
        .library(name: "TomoTunerGroups", targets: ["TomoTunerGroups"]),
    ],
    dependencies: [
        .package(name: "TomoEngine", path: "../../packages/tomo-engine"),
    ],
    targets: [
        // A Jellyfin M3U tuner's groups and channel ids (plugins/withTunerGroups.js copies the
        // same files into the app), over the engine's playlist loader.
        .target(
            name: "TomoTunerGroups",
            dependencies: [.product(name: "TomoLiveSources", package: "TomoEngine")],
            path: "TunerGroups",
            exclude: ["TunerGroupsModule.swift", "TunerGroups.m"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "TomoTunerGroupsTests",
            dependencies: ["TomoTunerGroups", .product(name: "TomoLiveSources", package: "TomoEngine")],
            path: "Tests/TomoTunerGroupsTests",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // The book reader's page renderer (plugins/withBookRenderer.js copies the same
        // files into the app). No UIKit outside the bridge, so it tests on the host.
        .target(
            name: "TomoBooks",
            dependencies: [.product(name: "Libarchive", package: "TomoEngine")],
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
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
