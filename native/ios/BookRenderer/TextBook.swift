//
//  TextBook.swift
//  TomoTV
//
//  A reflowable book at one page size and font size: chapters built lazily, paginated in
//  order, pages rendered on demand. A relayout keeps the reader's place by chapter and offset.
//

import CoreGraphics
import CoreText
import Foundation

final class TextBook: BookSource {
    let kind = BookKind.text
    private let source: TextChapters
    private let directory: URL
    private(set) var pageSize: CGSize
    private(set) var fontSize: CGFloat
    private var paginator: TextPaginator
    private var chapters: [NSAttributedString?]
    private var framesetters: [CTFramesetter?]
    private var chapterPages: [[CFRange]?]
    private(set) var pages: [TextPage] = []
    /// Chapters paginated so far, in order; `pages` is complete once this reaches chapterCount.
    private(set) var paginatedChapters = 0
    private var layoutGeneration = 0

    init(source: TextChapters, directory: URL, pageSize: CGSize, fontSize: CGFloat) {
        self.source = source
        self.directory = directory
        self.pageSize = pageSize
        self.fontSize = fontSize
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        paginator = TextPaginator(pageSize: pageSize)
        chapters = Array(repeating: nil, count: source.chapterCount)
        framesetters = Array(repeating: nil, count: source.chapterCount)
        chapterPages = Array(repeating: nil, count: source.chapterCount)
    }

    var title: String? { source.title }
    var chapterCount: Int { source.chapterCount }
    var pageCount: Int { pages.count }
    var isPaginated: Bool { paginatedChapters >= chapterCount }

    /// Paginates the next chapter; false once every chapter is in `pages`.
    @discardableResult
    func paginateNextChapter() -> Bool {
        guard paginatedChapters < chapterCount else { return false }
        let index = paginatedChapters
        let ranges = paginate(chapter: index)
        pages += ranges.map { TextPage(chapter: index, range: $0) }
        paginatedChapters += 1
        return paginatedChapters < chapterCount
    }

    func paginateAll() {
        while paginateNextChapter() {}
    }

    func renderPage(_ index: Int, zoom: Int, scale: CGFloat, pageSize: CGSize) throws -> RenderedPage {
        while index >= pages.count, paginateNextChapter() {}
        guard pages.indices.contains(index) else { throw BookError.badIndex(index) }
        let page = pages[index]
        let file = directory.appendingPathComponent("t\(layoutGeneration)-\(index)-\(zoom).jpg")
        let renderScale = scale * CGFloat(max(1, zoom))
        if FileManager.default.fileExists(atPath: file.path), let size = BookRender.imagePixelSize(at: file) {
            return RenderedPage(url: file, width: Int(size.width), height: Int(size.height))
        }
        guard let framesetter = framesetter(chapter: page.chapter),
              let image = paginator.render(framesetter, range: page.range, scale: renderScale)
        else { throw BookError.open("page \(index) did not render") }
        try BookRender.writeJPEG(image, to: file)
        return RenderedPage(url: file, width: image.width, height: image.height)
    }

    /// Where a page starts, for keeping the place across a relayout.
    func anchor(forPage index: Int) -> (chapter: Int, offset: Int) {
        guard pages.indices.contains(index) else { return (0, 0) }
        return (pages[index].chapter, pages[index].range.location)
    }

    /// New page size or font size; returns the page holding the anchor in the new layout.
    func relayout(pageSize: CGSize, fontSize: CGFloat, anchor: (chapter: Int, offset: Int)) -> Int {
        self.pageSize = pageSize
        self.fontSize = fontSize
        paginator = TextPaginator(pageSize: pageSize)
        chapters = Array(repeating: nil, count: chapterCount)
        framesetters = Array(repeating: nil, count: chapterCount)
        chapterPages = Array(repeating: nil, count: chapterCount)
        pages = []
        paginatedChapters = 0
        layoutGeneration += 1
        paginateAll()
        return page(forChapter: anchor.chapter, offset: anchor.offset)
    }

    func page(forChapter chapter: Int, offset: Int) -> Int {
        var best = 0
        for (index, page) in pages.enumerated() {
            if page.chapter < chapter { best = index; continue }
            if page.chapter > chapter { break }
            if page.range.location <= offset { best = index } else { break }
        }
        return best
    }

    // MARK: - Chapters

    private func attributed(chapter index: Int) -> NSAttributedString? {
        if let cached = chapters[index] { return cached }
        guard let (html, base) = try? source.chapterHTML(index) else { return nil }
        let options = HtmlTextOptions(fontSize: fontSize, columnWidth: paginator.column.width, maxImageHeight: paginator.maxImageHeight)
        let built = HtmlTextBuilder.build(html: html, base: base, options: options)
        chapters[index] = built
        return built
    }

    private func framesetter(chapter index: Int) -> CTFramesetter? {
        if let cached = framesetters[index] { return cached }
        guard let text = attributed(chapter: index), text.length > 0 else { return nil }
        let framesetter = CTFramesetterCreateWithAttributedString(text)
        framesetters[index] = framesetter
        return framesetter
    }

    private func paginate(chapter index: Int) -> [CFRange] {
        if let cached = chapterPages[index] { return cached }
        var ranges: [CFRange] = []
        if let framesetter = framesetter(chapter: index), let text = chapters[index] {
            ranges = paginator.paginate(framesetter, length: text.length)
        }
        chapterPages[index] = ranges
        return ranges
    }
}
