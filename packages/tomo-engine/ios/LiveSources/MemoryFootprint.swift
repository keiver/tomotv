//
//  MemoryFootprint.swift
//  TomoTV
//
//  The process's physical footprint, the figure jetsam and Xcode's memory gauge use.
//

import Darwin

enum MemoryFootprint {
    static func bytes() -> Int {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let status = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        return status == KERN_SUCCESS ? Int(info.phys_footprint) : 0
    }

    /// Bytes left before the system kills the app for memory; nil where no limit is reported (macOS, or 0 from the system).
    static func availableBytes() -> Int? {
        #if os(iOS) || os(tvOS)
        let bytes = os_proc_available_memory()
        return bytes > 0 ? Int(bytes) : nil
        #else
        return nil
        #endif
    }
}
