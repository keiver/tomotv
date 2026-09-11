//
//  BookSource.swift
//  TomoTV
//
//  What every book becomes for the viewer: a page count and page images on demand.
//

import CoreGraphics
import Foundation

enum BookKind: String {
    /// Pages are pictures already: comics and PDFs.
    case fixed
    /// Pages are laid out from text at a font size: EPUB, MOBI, KF8.
    case text
}

struct RenderedPage {
    let url: URL
    let width: Int
    let height: Int
}

protocol BookSource: AnyObject {
    var kind: BookKind { get }
    var pageCount: Int { get }
    var title: String? { get }
    /// `pageSize` is the viewport in points, `scale` the device pixel ratio, `zoom` 1...3.
    func renderPage(_ index: Int, zoom: Int, scale: CGFloat, pageSize: CGSize) throws -> RenderedPage
}

/// A text book's chapters as HTML, whatever the container.
protocol TextChapters: AnyObject {
    var chapterCount: Int { get }
    var title: String? { get }
    /// The chapter's markup and the directory its relative image paths resolve against.
    func chapterHTML(_ index: Int) throws -> (html: String, base: URL)
}

enum BookOpener {
    static let fixedExtensions: Set<String> = ["pdf", "cbz", "cbr", "cbt", "cb7"]
    static let textExtensions: Set<String> = ["epub", "mobi", "azw", "azw3", "prc"]

    static func kind(forExtension ext: String) -> BookKind? {
        if fixedExtensions.contains(ext) { return .fixed }
        if textExtensions.contains(ext) { return .text }
        return nil
    }

    /// Render directories of books that are no longer open. An app killed mid-read never reaches
    /// closeBook, so its token directory would otherwise stay in Caches for good.
    static func purgeStale(root: URL, keeping open: Set<String>) {
        guard let entries = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return }
        for entry in entries where !open.contains(entry.lastPathComponent) {
            try? FileManager.default.removeItem(at: entry)
        }
    }

    /// `directory` is the book's own scratch directory for extracted entries and rendered pages.
    static func open(url: URL, directory: URL, pageSize: CGSize, fontSize: CGFloat) throws -> BookSource {
        let ext = url.pathExtension.lowercased()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        switch ext {
        case "pdf":
            return try PdfBook(url: url, directory: directory)
        case "cbz", "cbr", "cbt", "cb7":
            return try ImageBook(url: url, directory: directory)
        case "epub":
            return TextBook(source: try EpubBook(url: url, directory: directory.appendingPathComponent("epub")), directory: directory, pageSize: pageSize, fontSize: fontSize)
        case "mobi", "azw", "azw3", "prc":
            return TextBook(source: try MobiBook(url: url, directory: directory.appendingPathComponent("mobi")), directory: directory, pageSize: pageSize, fontSize: fontSize)
        default:
            throw BookError.unsupported(ext)
        }
    }
}
