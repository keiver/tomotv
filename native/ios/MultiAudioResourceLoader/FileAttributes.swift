//
//  FileAttributes.swift
//  TomoTV
//
//  Marks downloaded media as do-not-back-up. iOS backs the Documents directory up to
//  iCloud, and Apple's Data Storage Guidelines reject apps that back up media the app
//  can fetch again. expo-file-system exposes no API for the flag.
//
//  Lives alongside MultiAudioResourceLoader because the target has a single
//  SWIFT_OBJC_BRIDGING_HEADER, configured by plugins/withMultiAudioResourceLoader.js.
//

import Foundation

@objc(FileAttributes)
class FileAttributes: NSObject {

    /// Applies to a directory as well as a file; marking the downloads folder covers
    /// everything written into it, which is why callers only ever set it once.
    @objc
    func setExcludedFromBackup(
        _ path: String,
        excluded: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // expo-file-system hands out `file://` URIs; a plain path is accepted too.
        var url = path.hasPrefix("file://")
            ? (URL(string: path) ?? URL(fileURLWithPath: path))
            : URL(fileURLWithPath: path)

        guard FileManager.default.fileExists(atPath: url.path) else {
            reject("not_found", "No file or directory at \(url.path)", nil)
            return
        }

        var values = URLResourceValues()
        values.isExcludedFromBackup = excluded
        do {
            try url.setResourceValues(values)
            resolve(nil)
        } catch {
            reject("set_failed", "Could not set isExcludedFromBackup: \(error.localizedDescription)", error)
        }
    }

    /// Reads the flag back, so the app can prove the exclusion took rather than assume it.
    @objc
    func isExcludedFromBackup(
        _ path: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let url = path.hasPrefix("file://")
            ? (URL(string: path) ?? URL(fileURLWithPath: path))
            : URL(fileURLWithPath: path)
        do {
            let values = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
            resolve(values.isExcludedFromBackup ?? false)
        } catch {
            reject("read_failed", "Could not read isExcludedFromBackup: \(error.localizedDescription)", error)
        }
    }
}
