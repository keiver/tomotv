//
//  DeviceEnvironment.swift
//  TomoTV
//
//  Reports whether the app is running on a Mac, which nothing in React Native
//  can answer: an iOS build run by macOS ("Designed for iPad") reports the pad
//  idiom, and Platform.isMacCatalyst is a compile-time flag that is false for it.
//
//  Lives alongside MultiAudioResourceLoader because the target has a single
//  SWIFT_OBJC_BRIDGING_HEADER, configured by plugins/withMultiAudioResourceLoader.js.
//

import Foundation

@objc(DeviceEnvironment)
class DeviceEnvironment: NSObject {

    /// Both ways the app reaches a desktop: the iOS binary run by macOS, and a
    /// future Mac Catalyst build. Available on every platform we ship (tvOS 14+,
    /// iOS 14+), where it is simply false.
    @objc
    func constantsToExport() -> [AnyHashable: Any]! {
        let info = ProcessInfo.processInfo
        return ["isMac": info.isiOSAppOnMac || info.isMacCatalystApp]
    }
}
