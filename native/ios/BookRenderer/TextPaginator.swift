//
//  TextPaginator.swift
//  TomoTV
//
//  CoreText pagination of one chapter into page-sized frames, and the page render:
//  the frame drawn into a bitmap, then every picture run drawn into its reserved box.
//

import CoreGraphics
import CoreText
import Foundation

struct TextPage {
    let chapter: Int
    let range: CFRange
}

final class TextPaginator {
    let pageSize: CGSize
    let column: CGRect

    init(pageSize: CGSize) {
        self.pageSize = pageSize
        let horizontal = max(24, (pageSize.width * 0.08).rounded())
        let vertical = max(20, (pageSize.height * 0.07).rounded())
        column = CGRect(x: horizontal, y: vertical, width: pageSize.width - 2 * horizontal, height: pageSize.height - 2 * vertical)
    }

    /// A picture may never be taller than the column, or a page could not hold it.
    var maxImageHeight: CGFloat { column.height }

    func paginate(_ framesetter: CTFramesetter, length: Int) -> [CFRange] {
        let path = CGPath(rect: column, transform: nil)
        var ranges: [CFRange] = []
        var start = 0
        while start < length {
            let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: start, length: 0), path, nil)
            let visible = CTFrameGetVisibleStringRange(frame)
            guard visible.length > 0 else { break }
            ranges.append(visible)
            start += visible.length
        }
        return ranges
    }

    func render(_ framesetter: CTFramesetter, range: CFRange, scale: CGFloat) -> CGImage? {
        let width = Int((pageSize.width * scale).rounded()), height = Int((pageSize.height * scale).rounded())
        guard let context = BookRender.makeContext(width: width, height: height) else { return nil }
        context.scaleBy(x: scale, y: scale)
        let frame = CTFramesetterCreateFrame(framesetter, range, CGPath(rect: column, transform: nil), nil)
        CTFrameDraw(frame, context)
        drawImages(in: frame, context: context)
        return context.makeImage()
    }

    /// Line origins are relative to the frame path's bounding box, so the column origin is added.
    private func drawImages(in frame: CTFrame, context: CGContext) {
        guard let lines = CTFrameGetLines(frame) as? [CTLine], !lines.isEmpty else { return }
        var origins = [CGPoint](repeating: .zero, count: lines.count)
        CTFrameGetLineOrigins(frame, CFRange(location: 0, length: 0), &origins)
        for (line, origin) in zip(lines, origins) {
            guard let runs = CTLineGetGlyphRuns(line) as? [CTRun] else { continue }
            for run in runs {
                guard let attributes = CTRunGetAttributes(run) as? [NSAttributedString.Key: Any],
                      let ref = attributes[BookTextAttribute.image] as? BookImageRef,
                      let image = BookRender.loadImage(at: ref.url)
                else { continue }
                var position = CGPoint.zero
                CTRunGetPositions(run, CFRange(location: 0, length: 1), &position)
                let rect = CGRect(x: column.minX + origin.x + position.x, y: column.minY + origin.y, width: ref.size.width, height: ref.size.height)
                context.draw(image, in: rect)
            }
        }
    }
}
