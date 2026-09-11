//
//  BookArchive.swift
//  TomoTV
//
//  Read side of libarchive: the formats a comic archive or an EPUB container comes in.
//

import Foundation
import Libarchive

struct ArchiveEntry: Equatable {
    let path: String
    let size: Int64
}

final class BookArchive {
    let url: URL

    init(url: URL) {
        self.url = url
    }

    /// Regular files, in archive order.
    func entries() throws -> [ArchiveEntry] {
        let reader = try openReader()
        defer { archive_read_free(reader) }
        var result: [ArchiveEntry] = []
        var entry: OpaquePointer?
        while archive_read_next_header(reader, &entry) == ARCHIVE_OK {
            guard let entry, Self.isRegularFile(entry) else {
                archive_read_data_skip(reader)
                continue
            }
            result.append(ArchiveEntry(path: Self.path(of: entry), size: archive_entry_size(entry)))
            archive_read_data_skip(reader)
        }
        return result
    }

    /// One entry's bytes to `destination`. Solid archives (RAR, 7-Zip) decode every entry before it.
    func extract(_ path: String, to destination: URL) throws {
        let reader = try openReader()
        defer { archive_read_free(reader) }
        var entry: OpaquePointer?
        while archive_read_next_header(reader, &entry) == ARCHIVE_OK {
            guard let entry else { continue }
            if Self.path(of: entry) == path {
                try write(reader, to: destination)
                return
            }
            archive_read_data_skip(reader)
        }
        throw BookError.archive("no entry named \(path)")
    }

    /// Every regular file into `directory`, keeping the archive's relative paths.
    /// Entries that would escape the directory are skipped.
    @discardableResult
    func extractAll(to directory: URL) throws -> [String] {
        let reader = try openReader()
        defer { archive_read_free(reader) }
        var written: [String] = []
        var entry: OpaquePointer?
        while archive_read_next_header(reader, &entry) == ARCHIVE_OK {
            guard let entry, Self.isRegularFile(entry) else {
                archive_read_data_skip(reader)
                continue
            }
            let path = Self.path(of: entry)
            guard Self.isSafe(path) else {
                archive_read_data_skip(reader)
                continue
            }
            let target = directory.appendingPathComponent(path)
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try write(reader, to: target)
            written.append(path)
        }
        return written
    }

    // MARK: - libarchive

    private func openReader() throws -> OpaquePointer {
        guard let reader = archive_read_new() else { throw BookError.archive("archive_read_new failed") }
        archive_read_support_format_zip(reader)
        archive_read_support_format_tar(reader)
        archive_read_support_format_rar(reader)
        archive_read_support_format_rar5(reader)
        archive_read_support_format_7zip(reader)
        archive_read_support_filter_gzip(reader)
        archive_read_support_filter_bzip2(reader)
        archive_read_support_filter_xz(reader)
        if archive_read_open_filename(reader, url.path, 1 << 16) != ARCHIVE_OK {
            let message = Self.message(reader)
            archive_read_free(reader)
            throw BookError.archive(message)
        }
        return reader
    }

    private func write(_ reader: OpaquePointer, to destination: URL) throws {
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }
        var buffer: UnsafeRawPointer?
        var size = 0
        var offset: Int64 = 0
        while true {
            let status = archive_read_data_block(reader, &buffer, &size, &offset)
            if status == ARCHIVE_EOF { break }
            if status != ARCHIVE_OK { throw BookError.archive(Self.message(reader)) }
            if let buffer, size > 0 { handle.write(Data(bytes: buffer, count: size)) }
        }
    }

    private static func message(_ reader: OpaquePointer) -> String {
        guard let text = archive_error_string(reader) else { return "libarchive error" }
        return String(cString: text)
    }

    private static func path(of entry: OpaquePointer) -> String {
        guard let text = archive_entry_pathname_utf8(entry) ?? archive_entry_pathname(entry) else { return "" }
        return String(cString: text)
    }

    private static func isRegularFile(_ entry: OpaquePointer) -> Bool {
        (archive_entry_filetype(entry) & 0o170000) == 0o100000
    }

    private static func isSafe(_ path: String) -> Bool {
        !path.hasPrefix("/") && !path.split(separator: "/").contains("..")
    }
}
