//
//  ImageBook.swift
//  TomoTV
//
//  A comic archive: its pictures, in natural name order, handed out at original resolution.
//

import CoreGraphics
import Foundation

final class ImageBook: BookSource {
    /// What ImageIO decodes on tvOS, measured with CGImageSourceCopyTypeIdentifiers.
    static let imageExtensions: Set<String> = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "avif"]

    let kind = BookKind.fixed
    let title: String? = nil
    private let archive: BookArchive
    private let pages: [ArchiveEntry]
    private let directory: URL
    /// RAR and 7-Zip are usually solid, so one pass at open beats a pass per page.
    private let extractedAll: Bool

    init(url: URL, directory: URL) throws {
        archive = BookArchive(url: url)
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        pages = try archive.entries()
            .filter(Self.isPage)
            .sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
        guard !pages.isEmpty else { throw BookError.open("No pictures in this archive") }
        let ext = url.pathExtension.lowercased()
        extractedAll = ext == "cbr" || ext == "cb7"
        if extractedAll {
            try archive.extractAll(to: directory.appendingPathComponent("all"))
        }
    }

    var pageCount: Int { pages.count }

    func renderPage(_ index: Int, zoom: Int, scale: CGFloat, pageSize: CGSize) throws -> RenderedPage {
        guard pages.indices.contains(index) else { throw BookError.badIndex(index) }
        let entry = pages[index]
        let file: URL
        if extractedAll {
            file = directory.appendingPathComponent("all").appendingPathComponent(entry.path)
        } else {
            file = directory.appendingPathComponent("\(index).\((entry.path as NSString).pathExtension.lowercased())")
            if !FileManager.default.fileExists(atPath: file.path) {
                try archive.extract(entry.path, to: file)
            }
        }
        let size = BookRender.imagePixelSize(at: file) ?? .zero
        return RenderedPage(url: file, width: Int(size.width), height: Int(size.height))
    }

    static func isPage(_ entry: ArchiveEntry) -> Bool {
        let name = (entry.path as NSString).lastPathComponent
        guard !name.hasPrefix("."), !entry.path.contains("__MACOSX/"), entry.size > 0 else { return false }
        return imageExtensions.contains((name as NSString).pathExtension.lowercased())
    }
}
