//
//  DeviceEnvironment.swift
//  TomoTV
//
//  What machine the app is on, for utils/hostEnvironment.ts: whether it is a Mac, which
//  nothing in React Native can answer, and the hardware the diagnostics log names.
//
//  Lives alongside MultiAudioResourceLoader because the target has a single
//  SWIFT_OBJC_BRIDGING_HEADER, configured by plugins/withMultiAudioResourceLoader.js.
//

import Foundation

@objc(DeviceEnvironment)
class DeviceEnvironment: NSObject {

    @objc
    func constantsToExport() -> [AnyHashable: Any]! {
        let info = ProcessInfo.processInfo
        let model = DeviceEnvironment.modelIdentifier()
        return [
            // Both ways the app reaches a desktop: the iOS binary run by macOS, and a Catalyst build.
            "isMac": info.isiOSAppOnMac || info.isMacCatalystApp,
            "model": model,
            "marketingName": DeviceEnvironment.marketingName(for: model) ?? NSNull(),
            "cores": info.activeProcessorCount,
            "memoryBytes": info.physicalMemory,
        ]
    }

    /// "AppleTV6,2" on a device. A Mac and the simulator report the CPU there, so those read
    /// the simulated model or the Mac's own identifier instead.
    private static func modelIdentifier() -> String {
        var system = utsname()
        uname(&system)
        let machine = withUnsafePointer(to: &system.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
        }
        guard machine == "arm64" || machine == "x86_64" else { return machine }
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return simulated }
        return sysctlString("hw.model") ?? machine
    }

    /// The model as Apple sells it, for the devices iOS 16.4 and tvOS 16.4 run on. A Mac or a
    /// model newer than this table reads nil and the diagnostics keep the identifier.
    private static func marketingName(for identifier: String) -> String? {
        switch identifier {
        case "AppleTV5,3": return "Apple TV HD"
        case "AppleTV6,2": return "Apple TV 4K"
        case "AppleTV11,1": return "Apple TV 4K (2nd generation)"
        case "AppleTV14,1": return "Apple TV 4K (3rd generation)"
        case "iPad6,3", "iPad6,4": return "iPad Pro (9.7-inch)"
        case "iPad6,7", "iPad6,8": return "iPad Pro (12.9-inch) (1st generation)"
        case "iPad6,11", "iPad6,12": return "iPad (5th generation)"
        case "iPad7,1", "iPad7,2": return "iPad Pro (12.9-inch) (2nd generation)"
        case "iPad7,3", "iPad7,4": return "iPad Pro (10.5-inch)"
        case "iPad7,5", "iPad7,6": return "iPad (6th generation)"
        case "iPad7,11", "iPad7,12": return "iPad (7th generation)"
        case "iPad8,1", "iPad8,2", "iPad8,3", "iPad8,4": return "iPad Pro (11-inch) (1st generation)"
        case "iPad8,5", "iPad8,6", "iPad8,7", "iPad8,8": return "iPad Pro (12.9-inch) (3rd generation)"
        case "iPad8,9", "iPad8,10": return "iPad Pro (11-inch) (2nd generation)"
        case "iPad8,11", "iPad8,12": return "iPad Pro (12.9-inch) (4th generation)"
        case "iPad11,1", "iPad11,2": return "iPad mini (5th generation)"
        case "iPad11,3", "iPad11,4": return "iPad Air (3rd generation)"
        case "iPad11,6", "iPad11,7": return "iPad (8th generation)"
        case "iPad12,1", "iPad12,2": return "iPad (9th generation)"
        case "iPad13,1", "iPad13,2": return "iPad Air (4th generation)"
        case "iPad13,4", "iPad13,5", "iPad13,6", "iPad13,7": return "iPad Pro (11-inch) (3rd generation)"
        case "iPad13,8", "iPad13,9", "iPad13,10", "iPad13,11": return "iPad Pro (12.9-inch) (5th generation)"
        case "iPad13,16", "iPad13,17": return "iPad Air (5th generation)"
        case "iPad13,18", "iPad13,19": return "iPad (10th generation)"
        case "iPad14,1", "iPad14,2": return "iPad mini (6th generation)"
        case "iPad14,3", "iPad14,4": return "iPad Pro (11-inch) (4th generation)"
        case "iPad14,5", "iPad14,6": return "iPad Pro (12.9-inch) (6th generation)"
        case "iPad14,8", "iPad14,9": return "iPad Air 11-inch (M2)"
        case "iPad14,10", "iPad14,11": return "iPad Air 13-inch (M2)"
        case "iPad15,3", "iPad15,4": return "iPad Air 11-inch (M3)"
        case "iPad15,5", "iPad15,6": return "iPad Air 13-inch (M3)"
        case "iPad15,7", "iPad15,8": return "iPad (A16)"
        case "iPad16,1", "iPad16,2": return "iPad mini (A17 Pro)"
        case "iPad16,3", "iPad16,4": return "iPad Pro 11-inch (M4)"
        case "iPad16,5", "iPad16,6": return "iPad Pro 13-inch (M4)"
        case "iPad16,8", "iPad16,9": return "iPad Air 11-inch (M4)"
        case "iPad16,10", "iPad16,11": return "iPad Air 13-inch (M4)"
        case "iPad17,1", "iPad17,2": return "iPad Pro 11-inch (M5)"
        case "iPad17,3", "iPad17,4": return "iPad Pro 13-inch (M5)"
        case "iPhone10,1", "iPhone10,4": return "iPhone 8"
        case "iPhone10,2", "iPhone10,5": return "iPhone 8 Plus"
        case "iPhone10,3", "iPhone10,6": return "iPhone X"
        case "iPhone11,2": return "iPhone XS"
        case "iPhone11,4", "iPhone11,6": return "iPhone XS Max"
        case "iPhone11,8": return "iPhone XR"
        case "iPhone12,1": return "iPhone 11"
        case "iPhone12,3": return "iPhone 11 Pro"
        case "iPhone12,5": return "iPhone 11 Pro Max"
        case "iPhone12,8": return "iPhone SE (2nd generation)"
        case "iPhone13,1": return "iPhone 12 mini"
        case "iPhone13,2": return "iPhone 12"
        case "iPhone13,3": return "iPhone 12 Pro"
        case "iPhone13,4": return "iPhone 12 Pro Max"
        case "iPhone14,2": return "iPhone 13 Pro"
        case "iPhone14,3": return "iPhone 13 Pro Max"
        case "iPhone14,4": return "iPhone 13 mini"
        case "iPhone14,5": return "iPhone 13"
        case "iPhone14,6": return "iPhone SE (3rd generation)"
        case "iPhone14,7": return "iPhone 14"
        case "iPhone14,8": return "iPhone 14 Plus"
        case "iPhone15,2": return "iPhone 14 Pro"
        case "iPhone15,3": return "iPhone 14 Pro Max"
        case "iPhone15,4": return "iPhone 15"
        case "iPhone15,5": return "iPhone 15 Plus"
        case "iPhone16,1": return "iPhone 15 Pro"
        case "iPhone16,2": return "iPhone 15 Pro Max"
        case "iPhone17,1": return "iPhone 16 Pro"
        case "iPhone17,2": return "iPhone 16 Pro Max"
        case "iPhone17,3": return "iPhone 16"
        case "iPhone17,4": return "iPhone 16 Plus"
        case "iPhone17,5": return "iPhone 16e"
        case "iPhone18,1": return "iPhone 17 Pro"
        case "iPhone18,2": return "iPhone 17 Pro Max"
        case "iPhone18,3": return "iPhone 17"
        case "iPhone18,4": return "iPhone Air"
        case "iPhone18,5": return "iPhone 17e"
        default: return nil
        }
    }

    private static func sysctlString(_ name: String) -> String? {
        var size = 0
        guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
        var buffer = [CChar](repeating: 0, count: size)
        guard sysctlbyname(name, &buffer, &size, nil, 0) == 0 else { return nil }
        return String(cString: buffer)
    }
}
