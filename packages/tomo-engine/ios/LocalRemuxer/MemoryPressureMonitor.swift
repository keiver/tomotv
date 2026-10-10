//
//  MemoryPressureMonitor.swift
//  TomoTV
//
//  The system's memory pressure events, logged with the headroom left so a
//  watermark kill is attributable. Eviction stays JS-owned: the live ring and
//  preview release their sessions on the app-side memoryWarning event.
//

import Foundation

enum MemoryPressureMonitor {
    static func levelName(_ event: DispatchSource.MemoryPressureEvent) -> String {
        event.contains(.critical) ? "critical" : "warning"
    }

    /// Headroom before the process watermark, in MB; nil where the API does not exist (macOS test host).
    static func headroomMB() -> Double? {
        #if os(iOS) || os(tvOS)
        return Double(os_proc_available_memory()) / 1_048_576
        #else
        return nil
        #endif
    }

    static func start() -> DispatchSourceMemoryPressure {
        let source = DispatchSource.makeMemoryPressureSource(eventMask: [.warning, .critical], queue: .global(qos: .utility))
        source.setEventHandler {
            if let headroom = headroomMB() {
                NSLog("[LocalRemuxer] memory pressure %@, %.0f MB headroom", levelName(source.data), headroom)
            } else {
                NSLog("[LocalRemuxer] memory pressure %@", levelName(source.data))
            }
        }
        source.activate()
        return source
    }
}
