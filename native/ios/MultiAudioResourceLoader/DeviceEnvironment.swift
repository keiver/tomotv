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
        return [
            // Both ways the app reaches a desktop: the iOS binary run by macOS, and a Catalyst build.
            "isMac": info.isiOSAppOnMac || info.isMacCatalystApp,
            "model": DeviceEnvironment.modelIdentifier(),
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

    private static func sysctlString(_ name: String) -> String? {
        var size = 0
        guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
        var buffer = [CChar](repeating: 0, count: size)
        guard sysctlbyname(name, &buffer, &size, nil, 0) == 0 else { return nil }
        return String(cString: buffer)
    }
}
