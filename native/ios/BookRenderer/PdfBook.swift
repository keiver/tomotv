//
//  PdfBook.swift
//  TomoTV
//
//  A PDF through CoreGraphics, each page drawn at the viewport's fit times the zoom level.
//  CGPDF, not PDFKit: the tvOS SDK carries a PDFKit stub, but the tvOS runtime has no
//  such framework and an app linking it never launches.
//

import CoreGraphics
import Foundation

final class PdfBook: BookSource {
    let kind = BookKind.fixed
    private let document: CGPDFDocument
    private let directory: URL

    init(url: URL, directory: URL) throws {
        guard let document = CGPDFDocument(url as CFURL) else { throw BookError.open("Not a readable PDF") }
        if document.isEncrypted, !document.isUnlocked { throw BookError.locked }
        guard document.numberOfPages > 0 else { throw BookError.open("This PDF has no pages") }
        self.document = document
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    var pageCount: Int { document.numberOfPages }

    var title: String? {
        guard let info = document.info else { return nil }
        var string: CGPDFStringRef?
        guard CGPDFDictionaryGetString(info, "Title", &string), let string, let text = CGPDFStringCopyTextString(string) as String? else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    func renderPage(_ index: Int, zoom: Int, scale: CGFloat, pageSize: CGSize) throws -> RenderedPage {
        // CGPDF pages are 1-based.
        guard let page = document.page(at: index + 1) else { throw BookError.badIndex(index) }
        let file = directory.appendingPathComponent("\(index)-\(zoom).jpg")
        if FileManager.default.fileExists(atPath: file.path), let size = BookRender.imagePixelSize(at: file) {
            return RenderedPage(url: file, width: Int(size.width), height: Int(size.height))
        }
        let box = page.getBoxRect(.cropBox)
        let upright = page.rotationAngle % 180 != 0 ? CGSize(width: box.height, height: box.width) : box.size
        let fit = min(pageSize.width / upright.width, pageSize.height / upright.height) * scale * CGFloat(max(1, zoom))
        let width = Int((upright.width * fit).rounded()), height = Int((upright.height * fit).rounded())
        guard let context = BookRender.makeContext(width: width, height: height) else { throw BookError.open("cannot allocate a \(width)x\(height) page") }
        // The transform applies the page's own rotation and scales the crop box into the bitmap.
        context.concatenate(page.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: width, height: height), rotate: 0, preserveAspectRatio: true))
        context.drawPDFPage(page)
        guard let image = context.makeImage() else { throw BookError.open("page \(index) did not render") }
        try BookRender.writeJPEG(image, to: file)
        return RenderedPage(url: file, width: width, height: height)
    }
}
