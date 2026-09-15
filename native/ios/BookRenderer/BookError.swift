//
//  BookError.swift
//  TomoTV
//
//  Failures the book reader reports to JS, by code.
//

import Foundation

enum BookError: Error, LocalizedError {
    /// The file extension names no reader.
    case unsupported(String)
    /// The file did not open as the format its extension claims.
    case open(String)
    /// A password-protected PDF.
    case locked
    /// libarchive refused the archive; the message is archive_error_string.
    case archive(String)
    case badIndex(Int)

    var code: String {
        switch self {
        case .unsupported: return "unsupported"
        case .open: return "open_failed"
        case .locked: return "locked"
        case .archive: return "archive_failed"
        case .badIndex: return "bad_index"
        }
    }

    var errorDescription: String? {
        switch self {
        case .unsupported(let ext): return "No reader for .\(ext) files"
        case .open(let why): return why
        case .locked: return "This PDF needs a password"
        case .archive(let why): return why
        case .badIndex(let index): return "No page \(index)"
        }
    }
}
