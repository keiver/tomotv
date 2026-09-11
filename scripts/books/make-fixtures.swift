// Generates book fixtures: a 12-page PDF, the same pages as PNGs (for cbz/cbt/cb7),
// and a three-chapter EPUB. Usage: swift make-fixtures.swift <outdir>
import Foundation
import CoreGraphics
import CoreText
import ImageIO

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let pageCount = 12
let w = 1200.0, h = 1600.0

func drawPage(_ ctx: CGContext, index: Int) {
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    let hue = CGFloat(index) / CGFloat(pageCount)
    ctx.setFillColor(CGColor(red: 0.2 + 0.6 * hue, green: 0.3, blue: 1 - 0.7 * hue, alpha: 1))
    // A distinct shape per page: circle on even pages, square on odd, growing with the index.
    let size = 200.0 + Double(index) * 60.0
    let r = CGRect(x: (w - size) / 2, y: 300, width: size, height: size)
    if index % 2 == 0 { ctx.fillEllipse(in: r) } else { ctx.fill(r) }
    let font = CTFontCreateWithName("Helvetica-Bold" as CFString, 260, nil)
    let attr = NSAttributedString(string: "\(index + 1)", attributes: [kCTFontAttributeName as NSAttributedString.Key: font, kCTForegroundColorAttributeName as NSAttributedString.Key: CGColor(gray: 0.1, alpha: 1)])
    let line = CTLineCreateWithAttributedString(attr)
    let bounds = CTLineGetBoundsWithOptions(line, [])
    ctx.textPosition = CGPoint(x: (w - bounds.width) / 2, y: 1000)
    CTLineDraw(line, ctx)
    let small = CTFontCreateWithName("Helvetica" as CFString, 48, nil)
    let label = NSAttributedString(string: "Tomo TV fixture page \(index + 1) of \(pageCount)", attributes: [kCTFontAttributeName as NSAttributedString.Key: small, kCTForegroundColorAttributeName as NSAttributedString.Key: CGColor(gray: 0.3, alpha: 1)])
    let l2 = CTLineCreateWithAttributedString(label)
    ctx.textPosition = CGPoint(x: 80, y: 120)
    CTLineDraw(l2, ctx)
}

// PDF
var mediaBox = CGRect(x: 0, y: 0, width: w, height: h)
let pdfURL = out.appendingPathComponent("Tomo Fixture Book.pdf")
let pdf = CGContext(pdfURL as CFURL, mediaBox: &mediaBox, [kCGPDFContextTitle as String: "Tomo Fixture Book"] as CFDictionary)!
for i in 0..<pageCount { pdf.beginPDFPage(nil); drawPage(pdf, index: i); pdf.endPDFPage() }
pdf.closePDF()

// PNG pages
let pages = out.appendingPathComponent("pages")
try FileManager.default.createDirectory(at: pages, withIntermediateDirectories: true)
for i in 0..<pageCount {
    let ctx = CGContext(data: nil, width: Int(w), height: Int(h), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    drawPage(ctx, index: i)
    let img = ctx.makeImage()!
    // Two-digit names so a naive sort and a natural sort agree; page 10 tests the natural sort elsewhere.
    let name = String(format: "page-%02d.png", i + 1)
    let dest = CGImageDestinationCreateWithURL(pages.appendingPathComponent(name) as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, img, nil); CGImageDestinationFinalize(dest)
}
// One page as JPEG for the EPUB image test.
let jpgCtx = CGContext(data: nil, width: 600, height: 800, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
jpgCtx.scaleBy(x: 0.5, y: 0.5); drawPage(jpgCtx, index: 4)
let jpgDest = CGImageDestinationCreateWithURL(out.appendingPathComponent("figure.jpg") as CFURL, "public.jpeg" as CFString, 1, nil)!
CGImageDestinationAddImage(jpgDest, jpgCtx.makeImage()!, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary); CGImageDestinationFinalize(jpgDest)

// EPUB source tree
let epub = out.appendingPathComponent("epub-src")
try FileManager.default.createDirectory(at: epub.appendingPathComponent("OEBPS"), withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: epub.appendingPathComponent("META-INF"), withIntermediateDirectories: true)
try "application/epub+zip".write(to: epub.appendingPathComponent("mimetype"), atomically: true, encoding: .utf8)
try """
<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
""".write(to: epub.appendingPathComponent("META-INF/container.xml"), atomically: true, encoding: .utf8)
let lorem = (1...40).map { "Paragraph \($0). The quick brown fox jumps over the lazy dog while the five boxing wizards jump quickly; sphinx of black quartz, judge my vow. " + String(repeating: "Pack my box with five dozen liquor jugs. ", count: 4) }.map { "<p>\($0)</p>" }.joined(separator: "\n")
for c in 1...3 {
    let body = """
    <?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter \(c)</title></head><body>
    <h1>Chapter \(c)</h1>
    <p>This is <em>chapter \(c)</em> of the <strong>Tomo fixture book</strong>, with an entity &amp; a line<br/>break.</p>
    \(c == 2 ? "<p><img src=\"images/figure.jpg\" alt=\"figure\"/></p>" : "")
    \(lorem)
    </body></html>
    """
    try body.write(to: epub.appendingPathComponent("OEBPS/chapter\(c).xhtml"), atomically: true, encoding: .utf8)
}
try FileManager.default.createDirectory(at: epub.appendingPathComponent("OEBPS/images"), withIntermediateDirectories: true)
try FileManager.default.copyItem(at: out.appendingPathComponent("figure.jpg"), to: epub.appendingPathComponent("OEBPS/images/figure.jpg"))
try """
<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:5f2b1c2e-tomo-fixture</dc:identifier>
    <dc:title>Tomo Fixture Novel</dc:title><dc:language>en</dc:language><dc:creator>Tomo TV</dc:creator>
  </metadata>
  <manifest>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="chapter3.xhtml" media-type="application/xhtml+xml"/>
    <item id="fig" href="images/figure.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>
</package>
""".write(to: epub.appendingPathComponent("OEBPS/content.opf"), atomically: true, encoding: .utf8)
print("fixtures written to \(out.path)")
