//
//  EpubBook.swift
//  TomoTV
//
//  An EPUB container: unpacked once, its spine read out of the OPF.
//

import Foundation

final class EpubBook: TextChapters {
    private let chapters: [URL]
    let title: String?

    init(url: URL, directory: URL) throws {
        try BookArchive(url: url).extractAll(to: directory)
        let containerURL = directory.appendingPathComponent("META-INF/container.xml")
        guard let containerData = try? Data(contentsOf: containerURL) else { throw BookError.open("No META-INF/container.xml") }
        let container = OpfParser.parse(containerData)
        guard let rootfile = container.rootfile else { throw BookError.open("container.xml names no rootfile") }
        let opfURL = directory.appendingPathComponent(rootfile)
        guard let opfData = try? Data(contentsOf: opfURL) else { throw BookError.open("Missing \(rootfile)") }
        let opf = OpfParser.parse(opfData)
        let base = opfURL.deletingLastPathComponent()
        var chapters: [URL] = []
        for ref in opf.spine where ref.linear {
            guard let item = opf.manifest[ref.idref], Self.isDocument(item.mediaType) else { continue }
            let file = base.appendingPathComponent(item.href.removingPercentEncoding ?? item.href).standardizedFileURL
            if FileManager.default.fileExists(atPath: file.path) { chapters.append(file) }
        }
        guard !chapters.isEmpty else { throw BookError.open("This EPUB has no readable chapters") }
        self.chapters = chapters
        title = opf.title
    }

    var chapterCount: Int { chapters.count }

    func chapterHTML(_ index: Int) throws -> (html: String, base: URL) {
        guard chapters.indices.contains(index) else { throw BookError.badIndex(index) }
        let url = chapters[index]
        let data = try Data(contentsOf: url)
        let html = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
        return (html, url.deletingLastPathComponent())
    }

    private static func isDocument(_ mediaType: String) -> Bool {
        mediaType == "application/xhtml+xml" || mediaType == "text/html" || mediaType == "application/xml"
    }
}

/// container.xml and .opf share one tiny vocabulary: rootfile, item, itemref, dc:title.
final class OpfParser: NSObject, XMLParserDelegate {
    struct Item { let href: String; let mediaType: String }
    struct SpineRef { let idref: String; let linear: Bool }
    struct Result {
        var rootfile: String?
        var manifest: [String: Item] = [:]
        var spine: [SpineRef] = []
        var title: String?
    }

    private var result = Result()
    private var inTitle = false
    private var titleText = ""

    static func parse(_ data: Data) -> Result {
        let delegate = OpfParser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.parse()
        return delegate.result
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
        let name = elementName.split(separator: ":").last.map(String.init) ?? elementName
        switch name {
        case "rootfile":
            if result.rootfile == nil, let path = attributes["full-path"] { result.rootfile = path }
        case "item":
            if let id = attributes["id"], let href = attributes["href"] {
                result.manifest[id] = Item(href: href, mediaType: attributes["media-type"] ?? "")
            }
        case "itemref":
            if let idref = attributes["idref"] {
                result.spine.append(SpineRef(idref: idref, linear: attributes["linear"]?.lowercased() != "no"))
            }
        case "title":
            if result.title == nil { inTitle = true; titleText = "" }
        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if inTitle { titleText += string }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        if inTitle, elementName.hasSuffix("title") {
            inTitle = false
            let trimmed = titleText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { result.title = trimmed }
        }
    }
}
