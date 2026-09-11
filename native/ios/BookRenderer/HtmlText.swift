//
//  HtmlText.swift
//  TomoTV
//
//  Chapter markup (EPUB XHTML, MOBI HTML) to one attributed string of CoreText runs:
//  block tags break paragraphs, a small inline set styles text, pictures become run
//  delegates the paginator draws. Tolerant of unclosed tags; no CSS.
//

import CoreGraphics
import CoreText
import Foundation
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// A picture placed in the text. The run delegate reserves its box; the paginator draws it there.
final class BookImageRef: NSObject {
    let url: URL
    let size: CGSize

    init(url: URL, size: CGSize) {
        self.url = url
        self.size = size
    }
}

enum BookTextAttribute {
    static let image = NSAttributedString.Key("TomoBookImage")
}

enum BookFonts {
    /// The system serif design (New York) at `size`; the plain system font where no serif design exists.
    static func body(size: CGFloat) -> CTFont {
        #if canImport(UIKit)
        let base = UIFontDescriptor.preferredFontDescriptor(withTextStyle: .body)
        let font = UIFont(descriptor: base.withDesign(.serif) ?? base, size: size)
        #else
        let base = NSFontDescriptor.preferredFontDescriptor(forTextStyle: .body)
        let font = NSFont(descriptor: base.withDesign(.serif) ?? base, size: size) ?? NSFont.systemFont(ofSize: size)
        #endif
        // UIFont/NSFont are toll-free bridged to CTFont.
        return unsafeBitCast(font, to: CTFont.self)
    }

    static func variant(of font: CTFont, size: CGFloat, bold: Bool, italic: Bool) -> CTFont {
        var traits: CTFontSymbolicTraits = []
        if bold { traits.insert(.traitBold) }
        if italic { traits.insert(.traitItalic) }
        if traits.isEmpty {
            return CTFontGetSize(font) == size ? font : CTFontCreateCopyWithAttributes(font, size, nil, nil)
        }
        return CTFontCreateCopyWithSymbolicTraits(font, size, nil, traits, traits) ?? CTFontCreateCopyWithAttributes(font, size, nil, nil)
    }
}

struct HtmlTextOptions {
    var fontSize: CGFloat
    /// Pictures are scaled down to fit these; smaller ones keep their pixel size in points.
    var columnWidth: CGFloat
    var maxImageHeight: CGFloat
}

final class HtmlTextBuilder {
    static func build(html: String, base: URL, options: HtmlTextOptions) -> NSAttributedString {
        let builder = HtmlTextBuilder(base: base, options: options)
        builder.parse(html)
        builder.flushBlock()
        return builder.output
    }

    private let base: URL
    private let options: HtmlTextOptions
    private let bodyFont: CTFont
    private var fontCache: [String: CTFont] = [:]
    private let output = NSMutableAttributedString()
    private var block = NSMutableAttributedString()
    private var pendingSpace = false

    private var bold = 0, italic = 0, underline = 0, superscript = 0, subscriptDepth = 0
    private var headingLevel = 0, quoteDepth = 0, listDepth = 0, preDepth = 0, centered = 0
    private var skipDepth = 0
    private var listItemOpen = false

    private init(base: URL, options: HtmlTextOptions) {
        self.base = base
        self.options = options
        bodyFont = BookFonts.body(size: options.fontSize)
    }

    // MARK: - Tokenizer

    private func parse(_ html: String) {
        let text = html as NSString
        let length = text.length
        var i = 0
        while i < length {
            if text.character(at: i) == 0x3C { // <
                if text.substring(from: i).hasPrefix("<!--") {
                    let end = text.range(of: "-->", range: NSRange(location: i, length: length - i))
                    i = end.location == NSNotFound ? length : end.location + 3
                } else if text.substring(from: i).hasPrefix("<![CDATA[") {
                    let end = text.range(of: "]]>", range: NSRange(location: i, length: length - i))
                    let stop = end.location == NSNotFound ? length : end.location
                    handleText(text.substring(with: NSRange(location: i + 9, length: max(0, stop - i - 9))), literal: true)
                    i = end.location == NSNotFound ? length : stop + 3
                } else {
                    let close = Self.tagEnd(text, from: i + 1)
                    let tag = text.substring(with: NSRange(location: i + 1, length: max(0, close - i - 1)))
                    i = min(close + 1, length)
                    if tag.hasPrefix("!") || tag.hasPrefix("?") { continue }
                    handleTag(tag)
                }
            } else {
                let next = text.range(of: "<", range: NSRange(location: i, length: length - i))
                let stop = next.location == NSNotFound ? length : next.location
                handleText(text.substring(with: NSRange(location: i, length: stop - i)), literal: false)
                i = stop
            }
        }
    }

    /// Index of the `>` closing a tag, quotes respected; the end of text when unclosed.
    private static func tagEnd(_ text: NSString, from: Int) -> Int {
        var quote: unichar = 0
        var i = from
        while i < text.length {
            let c = text.character(at: i)
            if quote != 0 {
                if c == quote { quote = 0 }
            } else if c == 0x22 || c == 0x27 {
                quote = c
            } else if c == 0x3E {
                return i
            }
            i += 1
        }
        return text.length
    }

    private static let attributePattern = try! NSRegularExpression(pattern: "([A-Za-z_:][-A-Za-z0-9_:.]*)\\s*(?:=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+)))?", options: [])

    private func handleTag(_ raw: String) {
        var body = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        var closing = false
        if body.hasPrefix("/") { closing = true; body.removeFirst() }
        var selfClosing = false
        if body.hasSuffix("/") { selfClosing = true; body.removeLast() }
        let nameEnd = body.firstIndex(where: { $0 == " " || $0 == "\n" || $0 == "\t" || $0 == "\r" }) ?? body.endIndex
        var name = body[..<nameEnd].lowercased()
        if let colon = name.firstIndex(of: ":"), name.hasPrefix("mbp:") == false { name = String(name[name.index(after: colon)...]) }
        var attributes: [String: String] = [:]
        if !closing, nameEnd < body.endIndex {
            let rest = String(body[nameEnd...])
            let ns = rest as NSString
            for match in Self.attributePattern.matches(in: rest, range: NSRange(location: 0, length: ns.length)) {
                let key = ns.substring(with: match.range(at: 1)).lowercased()
                var value = ""
                for group in 2...4 where match.range(at: group).location != NSNotFound {
                    value = ns.substring(with: match.range(at: group))
                }
                attributes[key] = Self.decodeEntities(value)
            }
        }
        if closing { closeTag(name) } else { openTag(name, attributes, selfClosing: selfClosing) }
    }

    private static let skipped: Set<String> = ["head", "script", "style", "title", "noscript", "template", "metadata", "desc"]
    private static let blocks: Set<String> = ["p", "div", "section", "article", "aside", "header", "footer", "nav", "main", "figure", "figcaption",
                                              "address", "dd", "dt", "dl", "table", "tr", "tbody", "thead", "tfoot", "body", "html", "form", "fieldset",
                                              "details", "summary", "ul", "ol", "li", "blockquote", "pre", "center", "h1", "h2", "h3", "h4", "h5", "h6", "hr"]

    private func openTag(_ name: String, _ attributes: [String: String], selfClosing: Bool) {
        if Self.skipped.contains(name) {
            if !selfClosing { skipDepth += 1 }
            return
        }
        if skipDepth > 0 { return }
        switch name {
        case "br":
            if block.length > 0 { appendText("\u{2028}") }
            pendingSpace = false
        case "img":
            addImage(attributes["src"])
        case "image":
            addImage(attributes["href"] ?? attributes["xlink:href"])
        case "b", "strong": bold += 1
        case "i", "em", "cite", "dfn", "var": italic += 1
        case "u", "ins": underline += 1
        case "sup": superscript += 1
        case "sub": subscriptDepth += 1
        case "td", "th":
            if block.length > 0 { pendingSpace = true }
        case "h1", "h2", "h3", "h4", "h5", "h6":
            flushBlock()
            headingLevel = Int(name.dropFirst()) ?? 1
        case "blockquote":
            flushBlock()
            quoteDepth += 1
        case "ul", "ol":
            flushBlock()
            listDepth += 1
        case "li":
            flushBlock()
            listItemOpen = true
        case "pre":
            flushBlock()
            preDepth += 1
        case "center":
            flushBlock()
            centered += 1
        case "hr":
            flushBlock()
        default:
            if Self.blocks.contains(name) { flushBlock() }
        }
        if selfClosing, !["br", "img", "image", "hr"].contains(name) { closeTag(name) }
    }

    private func closeTag(_ name: String) {
        if Self.skipped.contains(name) {
            skipDepth = max(0, skipDepth - 1)
            return
        }
        if skipDepth > 0 { return }
        switch name {
        case "b", "strong": bold = max(0, bold - 1)
        case "i", "em", "cite", "dfn", "var": italic = max(0, italic - 1)
        case "u", "ins": underline = max(0, underline - 1)
        case "sup": superscript = max(0, superscript - 1)
        case "sub": subscriptDepth = max(0, subscriptDepth - 1)
        case "h1", "h2", "h3", "h4", "h5", "h6":
            flushBlock()
            headingLevel = 0
        case "blockquote":
            flushBlock()
            quoteDepth = max(0, quoteDepth - 1)
        case "ul", "ol":
            flushBlock()
            listDepth = max(0, listDepth - 1)
        case "li":
            flushBlock()
            listItemOpen = false
        case "pre":
            flushBlock()
            preDepth = max(0, preDepth - 1)
        case "center":
            flushBlock()
            centered = max(0, centered - 1)
        default:
            if Self.blocks.contains(name) { flushBlock() }
        }
    }

    // MARK: - Text

    private func handleText(_ raw: String, literal: Bool) {
        guard skipDepth == 0, !raw.isEmpty else { return }
        let decoded = literal ? raw : Self.decodeEntities(raw)
        if preDepth > 0 {
            appendText(decoded.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\n", with: "\u{2028}"))
            return
        }
        var run = ""
        for scalar in decoded.unicodeScalars {
            if scalar == " " || scalar == "\t" || scalar == "\n" || scalar == "\r" {
                pendingSpace = true
                continue
            }
            if pendingSpace, block.length > 0 || !run.isEmpty { run.append(" ") }
            pendingSpace = false
            run.unicodeScalars.append(scalar)
        }
        if !run.isEmpty { appendText(run) }
    }

    private func appendText(_ text: String) {
        if block.length == 0, listItemOpen { block.append(NSAttributedString(string: "\u{2022} ", attributes: runAttributes())) }
        block.append(NSAttributedString(string: text, attributes: runAttributes()))
    }

    private func runAttributes() -> [NSAttributedString.Key: Any] {
        let headingScale: [CGFloat] = [1.6, 1.4, 1.25, 1.15, 1.1, 1.05]
        var size = options.fontSize
        if headingLevel > 0 { size *= headingScale[min(headingLevel, 6) - 1] }
        if superscript > 0 || subscriptDepth > 0 { size *= 0.75 }
        let isBold = bold > 0 || headingLevel > 0
        let isItalic = italic > 0
        let key = "\(size)|\(isBold)|\(isItalic)"
        let font: CTFont
        if let cached = fontCache[key] {
            font = cached
        } else {
            font = BookFonts.variant(of: bodyFont, size: size, bold: isBold, italic: isItalic)
            fontCache[key] = font
        }
        var attributes: [NSAttributedString.Key: Any] = [
            kCTFontAttributeName as NSAttributedString.Key: font,
            kCTForegroundColorAttributeName as NSAttributedString.Key: CGColor(gray: 0.08, alpha: 1),
        ]
        if underline > 0 { attributes[kCTUnderlineStyleAttributeName as NSAttributedString.Key] = CTUnderlineStyle.single.rawValue }
        if superscript > 0 { attributes[kCTBaselineOffsetAttributeName as NSAttributedString.Key] = options.fontSize * 0.35 }
        if subscriptDepth > 0 { attributes[kCTBaselineOffsetAttributeName as NSAttributedString.Key] = -options.fontSize * 0.15 }
        return attributes
    }

    private func flushBlock() {
        pendingSpace = false
        guard block.length > 0 else { return }
        let whole = NSRange(location: 0, length: block.length)
        block.addAttribute(kCTParagraphStyleAttributeName as NSAttributedString.Key, value: paragraphStyle(), range: whole)
        block.append(NSAttributedString(string: "\n", attributes: block.attributes(at: block.length - 1, effectiveRange: nil)))
        output.append(block)
        block = NSMutableAttributedString()
    }

    private func paragraphStyle(centered center: Bool = false, imageBlock: Bool = false) -> CTParagraphStyle {
        let size = options.fontSize
        var lineSpacing = size * 0.25
        var spacingAfter = imageBlock ? size * 0.75 : size * 0.5
        var spacingBefore = headingLevel > 0 ? size * 1.0 : 0
        var headIndent = CGFloat(quoteDepth) * size * 1.5 + CGFloat(listDepth) * size * 1.2
        var firstLineIndent = headIndent
        var alignment: CTTextAlignment = center || centered > 0 || imageBlock ? .center : .natural
        let settings = [
            CTParagraphStyleSetting(spec: .lineSpacingAdjustment, valueSize: MemoryLayout<CGFloat>.size, value: &lineSpacing),
            CTParagraphStyleSetting(spec: .paragraphSpacing, valueSize: MemoryLayout<CGFloat>.size, value: &spacingAfter),
            CTParagraphStyleSetting(spec: .paragraphSpacingBefore, valueSize: MemoryLayout<CGFloat>.size, value: &spacingBefore),
            CTParagraphStyleSetting(spec: .headIndent, valueSize: MemoryLayout<CGFloat>.size, value: &headIndent),
            CTParagraphStyleSetting(spec: .firstLineHeadIndent, valueSize: MemoryLayout<CGFloat>.size, value: &firstLineIndent),
            CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: &alignment),
        ]
        return CTParagraphStyleCreate(settings, settings.count)
    }

    // MARK: - Pictures

    private func addImage(_ source: String?) {
        guard let source, !source.isEmpty, !source.lowercased().hasPrefix("http"), !source.hasPrefix("data:") else { return }
        var path = source
        if let cut = path.firstIndex(where: { $0 == "#" || $0 == "?" }) { path = String(path[..<cut]) }
        path = path.removingPercentEncoding ?? path
        let url = base.appendingPathComponent(path).standardizedFileURL
        guard FileManager.default.fileExists(atPath: url.path), let pixels = BookRender.imagePixelSize(at: url) else { return }
        let fit = min(1, options.columnWidth / pixels.width, options.maxImageHeight / pixels.height)
        let ref = BookImageRef(url: url, size: CGSize(width: floor(pixels.width * fit), height: floor(pixels.height * fit)))
        flushBlock()
        var callbacks = CTRunDelegateCallbacks(
            version: kCTRunDelegateVersion1,
            dealloc: { pointer in Unmanaged<BookImageRef>.fromOpaque(pointer).release() },
            getAscent: { pointer in Unmanaged<BookImageRef>.fromOpaque(pointer).takeUnretainedValue().size.height },
            getDescent: { _ in 0 },
            getWidth: { pointer in Unmanaged<BookImageRef>.fromOpaque(pointer).takeUnretainedValue().size.width }
        )
        guard let delegate = CTRunDelegateCreate(&callbacks, Unmanaged.passRetained(ref).toOpaque()) else { return }
        let attributes: [NSAttributedString.Key: Any] = [
            kCTRunDelegateAttributeName as NSAttributedString.Key: delegate,
            kCTFontAttributeName as NSAttributedString.Key: bodyFont,
            kCTParagraphStyleAttributeName as NSAttributedString.Key: paragraphStyle(centered: true, imageBlock: true),
            BookTextAttribute.image: ref,
        ]
        output.append(NSAttributedString(string: "\u{FFFC}", attributes: attributes))
        output.append(NSAttributedString(string: "\n", attributes: [
            kCTFontAttributeName as NSAttributedString.Key: bodyFont,
            kCTParagraphStyleAttributeName as NSAttributedString.Key: paragraphStyle(centered: true, imageBlock: true),
        ]))
    }

    // MARK: - Entities

    private static let entityPattern = try! NSRegularExpression(pattern: "&(#[xX][0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});", options: [])
    private static let namedEntities: [String: String] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": "\u{A0}", "shy": "\u{AD}",
        "mdash": "\u{2014}", "ndash": "\u{2013}", "hellip": "\u{2026}", "lsquo": "\u{2018}", "rsquo": "\u{2019}", "sbquo": "\u{201A}",
        "ldquo": "\u{201C}", "rdquo": "\u{201D}", "bdquo": "\u{201E}", "laquo": "\u{AB}", "raquo": "\u{BB}", "bull": "\u{2022}",
        "middot": "\u{B7}", "copy": "\u{A9}", "reg": "\u{AE}", "trade": "\u{2122}", "deg": "\u{B0}", "plusmn": "\u{B1}",
        "frac12": "\u{BD}", "frac14": "\u{BC}", "frac34": "\u{BE}", "times": "\u{D7}", "divide": "\u{F7}", "para": "\u{B6}",
        "sect": "\u{A7}", "dagger": "\u{2020}", "Dagger": "\u{2021}", "euro": "\u{20AC}", "pound": "\u{A3}", "yen": "\u{A5}",
        "cent": "\u{A2}", "iexcl": "\u{A1}", "iquest": "\u{BF}", "ensp": "\u{2002}", "emsp": "\u{2003}", "thinsp": "\u{2009}",
        "zwnj": "\u{200C}", "zwj": "\u{200D}", "lrm": "\u{200E}", "rlm": "\u{200F}", "prime": "\u{2032}", "Prime": "\u{2033}",
        "minus": "\u{2212}", "larr": "\u{2190}", "rarr": "\u{2192}", "uarr": "\u{2191}", "darr": "\u{2193}", "hearts": "\u{2665}",
        "agrave": "à", "aacute": "á", "acirc": "â", "atilde": "ã", "auml": "ä", "aring": "å", "aelig": "æ", "ccedil": "ç",
        "egrave": "è", "eacute": "é", "ecirc": "ê", "euml": "ë", "igrave": "ì", "iacute": "í", "icirc": "î", "iuml": "ï",
        "ntilde": "ñ", "ograve": "ò", "oacute": "ó", "ocirc": "ô", "otilde": "õ", "ouml": "ö", "oslash": "ø", "ugrave": "ù",
        "uacute": "ú", "ucirc": "û", "uuml": "ü", "yacute": "ý", "yuml": "ÿ", "szlig": "ß", "eth": "ð", "thorn": "þ", "oelig": "œ",
        "Agrave": "À", "Aacute": "Á", "Acirc": "Â", "Atilde": "Ã", "Auml": "Ä", "Aring": "Å", "AElig": "Æ", "Ccedil": "Ç",
        "Egrave": "È", "Eacute": "É", "Ecirc": "Ê", "Euml": "Ë", "Igrave": "Ì", "Iacute": "Í", "Icirc": "Î", "Iuml": "Ï",
        "Ntilde": "Ñ", "Ograve": "Ò", "Oacute": "Ó", "Ocirc": "Ô", "Otilde": "Õ", "Ouml": "Ö", "Oslash": "Ø", "Ugrave": "Ù",
        "Uacute": "Ú", "Ucirc": "Û", "Uuml": "Ü", "Yacute": "Ý", "ETH": "Ð", "THORN": "Þ", "OElig": "Œ", "Scaron": "Š", "scaron": "š",
    ]

    static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        let ns = text as NSString
        var out = text
        for match in entityPattern.matches(in: text, range: NSRange(location: 0, length: ns.length)).reversed() {
            let name = ns.substring(with: match.range(at: 1))
            var replacement: String?
            if name.hasPrefix("#x") || name.hasPrefix("#X") {
                replacement = UInt32(name.dropFirst(2), radix: 16).flatMap(Unicode.Scalar.init).map { String(Character($0)) }
            } else if name.hasPrefix("#") {
                replacement = UInt32(name.dropFirst()).flatMap(Unicode.Scalar.init).map { String(Character($0)) }
            } else {
                replacement = namedEntities[name]
            }
            guard let replacement else { continue }
            out = (out as NSString).replacingCharacters(in: match.range, with: replacement)
        }
        return out
    }
}
