//
//  XmltvParser.swift
//  TomoTV
//
//  XMLTV guide parser on libxml2's SAX push interface: bytes in any chunking, channels and
//  programmes out as their closing tags land. Programmes outside the window are skipped at their
//  opening tag, so their text is never collected. Malformed input is counted, not fatal.
//

import Foundation
import libxml2

struct GuideChannel: Equatable {
    var id: String
    var displayNames: [String] = []
    var icon: String?
}

struct GuideEpisodeNumber: Equatable {
    var system: String?
    var value: String
}

struct GuideProgramme: Equatable {
    var channel: String
    /// Epoch milliseconds.
    var start: Int64
    var stop: Int64?
    var title = ""
    var subTitle: String?
    var desc: String?
    var categories: [String] = []
    var episodeNumbers: [GuideEpisodeNumber] = []
    var icon: String?
    var rating: String?
    var isNew = false
    var previouslyShown = false
}

/// Epoch milliseconds, inclusive at both ends.
struct GuideWindow: Equatable {
    var from: Int64
    var to: Int64

    /// A programme with no stop is open-ended: it overlaps every window after its start.
    func overlaps(start: Int64, stop: Int64?) -> Bool {
        (stop ?? Int64.max) >= from && start <= to
    }
}

/// Rewrites a bare `&` (one opening no entity or character reference) to `&amp;`, so libxml2 in
/// RECOVER mode keeps the text instead of dropping it. CDATA sections pass through untouched.
struct AmpersandEscaper {
    private static let cdataOpen = Array("<![CDATA[".utf8)
    private static let cdataClose = Array("]]>".utf8)
    private static let names = ["amp;", "lt;", "gt;", "quot;", "apos;"].map { Array($0.utf8) }
    /// Longest reference examined after `&`: `#x10FFFF;` is 9 bytes.
    private static let lookahead = 12

    private var held: [UInt8] = []
    private var inCData = false
    private var out: [UInt8] = []

    /// Filters a chunk; `emit` sees the rewritten bytes, valid only for the call. `flush` resolves held bytes.
    mutating func filter(_ chunk: UnsafeRawBufferPointer, flush: Bool, emit: (UnsafeRawBufferPointer) -> Void) {
        out.removeAll(keepingCapacity: true)
        if held.isEmpty {
            scan(chunk, flush: flush)
        } else {
            var joined = held
            joined.append(contentsOf: chunk)
            held.removeAll(keepingCapacity: true)
            joined.withUnsafeBytes { scan($0, flush: flush) }
        }
        if !out.isEmpty { out.withUnsafeBytes(emit) }
    }

    private mutating func scan(_ bytes: UnsafeRawBufferPointer, flush: Bool) {
        var i = 0
        let n = bytes.count
        while i < n {
            // Runs without `&`, `<` or `]` copy in one go.
            let runStart = i
            while i < n, bytes[i] != 0x26, bytes[i] != 0x3C, bytes[i] != 0x5D { i += 1 }
            if i > runStart { out.append(contentsOf: UnsafeRawBufferPointer(rebasing: bytes[runStart ..< i])) }
            if i == n { break }
            if inCData {
                if bytes[i] == 0x5D, let verdict = Self.matches(Self.cdataClose, bytes, i) {
                    guard verdict else { out.append(bytes[i]); i += 1; continue }
                    out.append(contentsOf: Self.cdataClose)
                    i += Self.cdataClose.count
                    inCData = false
                    continue
                }
                if bytes[i] == 0x5D, !flush { held.append(contentsOf: bytes[i...]); return }
                out.append(bytes[i])
                i += 1
            } else if bytes[i] == 0x3C {
                if let verdict = Self.matches(Self.cdataOpen, bytes, i) {
                    if verdict {
                        out.append(contentsOf: Self.cdataOpen)
                        i += Self.cdataOpen.count
                        inCData = true
                        continue
                    }
                } else if !flush {
                    held.append(contentsOf: bytes[i...])
                    return
                }
                out.append(bytes[i])
                i += 1
            } else if bytes[i] == 0x26 {
                guard let valid = Self.reference(bytes, i, flush: flush) else {
                    held.append(contentsOf: bytes[i...])
                    return
                }
                out.append(contentsOf: valid ? [0x26] : Array("&amp;".utf8))
                i += 1
            } else {
                out.append(bytes[i])
                i += 1
            }
        }
    }

    /// True or false when the marker is decided at `i`; nil when the chunk ends inside a possible match.
    private static func matches(_ marker: [UInt8], _ bytes: UnsafeRawBufferPointer, _ i: Int) -> Bool? {
        for (offset, byte) in marker.enumerated() {
            guard i + offset < bytes.count else { return nil }
            if bytes[i + offset] != byte { return false }
        }
        return true
    }

    /// Whether the `&` at `i` opens a predefined entity or a character reference; nil while undecidable.
    private static func reference(_ bytes: UnsafeRawBufferPointer, _ i: Int, flush: Bool) -> Bool? {
        let available = min(lookahead, bytes.count - i - 1)
        if bytes.count - i - 1 < lookahead, !flush {
            // Decide early when the bytes so far already rule a reference out.
            for offset in 1 ... max(available, 1) where i + offset < bytes.count {
                let byte = bytes[i + offset]
                if byte == 0x3B { break }
                if !(byte == 0x23 || byte == 0x78 || byte == 0x58 || (0x30 ... 0x39).contains(byte) || (0x41 ... 0x5A).contains(byte) || (0x61 ... 0x7A).contains(byte)) { return false }
            }
            if available < lookahead, !bytes[(i + 1) ..< (i + 1 + available)].contains(0x3B) { return nil }
        }
        let rest = UnsafeRawBufferPointer(rebasing: bytes[(i + 1) ..< min(i + 1 + lookahead, bytes.count)])
        for name in names where rest.count >= name.count && rest.prefix(name.count).elementsEqual(name) { return true }
        guard rest.count >= 3, rest[0] == 0x23 else { return false }
        var j = 1
        let hex = rest[1] == 0x78 || rest[1] == 0x58
        if hex { j = 2 }
        var digits = 0
        while j < rest.count, rest[j] != 0x3B {
            let byte = rest[j]
            let ok = (0x30 ... 0x39).contains(byte) || (hex && ((0x41 ... 0x46).contains(byte) || (0x61 ... 0x66).contains(byte)))
            guard ok else { return false }
            digits += 1
            j += 1
        }
        return j < rest.count && digits > 0
    }
}

final class XmltvParser: StreamSink {
    var onChannel: ((GuideChannel) -> Void)?
    var onProgramme: ((GuideProgramme) -> Void)?
    private(set) var channels = 0
    private(set) var programmes = 0
    private(set) var skipped = 0
    private(set) var errors = 0

    private enum Field {
        case none, displayName, title, subTitle, desc, category, episodeNum, ratingValue
    }

    /// Bytes kept per field; a runaway description is cut here.
    static let fieldCap = 1 << 20

    private let window: GuideWindow?
    private let sax: UnsafeMutablePointer<xmlSAXHandler>
    private var context: xmlParserCtxtPtr?
    private var head: [UInt8] = []
    /// Nil for UTF-16 input, where a byte-level rewrite would corrupt the text.
    private var escaper: AmpersandEscaper? = AmpersandEscaper()
    private var channel: GuideChannel?
    private var programme: GuideProgramme?
    private var skipping = false
    private var inRating = false
    private var field = Field.none
    /// Elements open inside the field being collected; their text belongs to it.
    private var fieldDepth = 0
    private var episodeSystem: String?
    private var text: [UInt8] = []

    init(window: GuideWindow? = nil) {
        self.window = window
        sax = .allocate(capacity: 1)
        sax.initialize(to: xmlSAXHandler())
        sax.pointee.initialized = UInt32(XML_SAX2_MAGIC)
        sax.pointee.startElementNs = { ctx, name, _, _, _, _, count, _, attributes in
            guard let ctx, let name else { return }
            Unmanaged<XmltvParser>.fromOpaque(ctx).takeUnretainedValue().start(name, Int(count), attributes)
        }
        sax.pointee.endElementNs = { ctx, name, _, _ in
            guard let ctx, let name else { return }
            Unmanaged<XmltvParser>.fromOpaque(ctx).takeUnretainedValue().end(name)
        }
        sax.pointee.characters = { ctx, bytes, length in
            guard let ctx, let bytes else { return }
            Unmanaged<XmltvParser>.fromOpaque(ctx).takeUnretainedValue().characters(bytes, Int(length))
        }
        sax.pointee.cdataBlock = sax.pointee.characters
        sax.pointee.serror = { ctx, _ in
            guard let ctx else { return }
            Unmanaged<XmltvParser>.fromOpaque(ctx).takeUnretainedValue().errors += 1
        }
    }

    deinit {
        if let context { xmlFreeParserCtxt(context) }
        sax.deinitialize(count: 1)
        sax.deallocate()
    }

    func push(_ bytes: UnsafeRawBufferPointer) {
        guard bytes.count > 0 else { return }
        guard context != nil else {
            // The context sniffs the encoding from its first chunk, which needs 4 bytes to tell UTF-16.
            head.append(contentsOf: bytes)
            if head.count >= 4 { open(flush: false) }
            return
        }
        escaped(bytes, flush: false) { parse($0, last: false) }
    }

    func finish() {
        if context == nil { open(flush: true) }
        guard context != nil else { return }
        var flushed = false
        escaper?.filter(UnsafeRawBufferPointer(start: nil, count: 0), flush: true) {
            flushed = true
            parse($0, last: true)
        }
        if !flushed { parse(UnsafeRawBufferPointer(start: nil, count: 0), last: true) }
    }

    private func open(flush: Bool) {
        let utf16 = head.count >= 2 && ((head[0] == 0xFF && head[1] == 0xFE) || (head[0] == 0xFE && head[1] == 0xFF) || head[0] == 0 || head[1] == 0)
        if utf16 { escaper = nil }
        let raw = head
        var first: [UInt8] = []
        raw.withUnsafeBytes { escaped($0, flush: flush) { first.append(contentsOf: $0) } }
        head = []
        // A held `<` or `&` can leave too few bytes to sniff: keep the raw bytes and scan them afresh with the
        // next chunk, so a held byte never jumps ahead of those let through. Under 4 bytes out opened no CDATA.
        guard first.count >= 4 || flush else {
            head = raw
            if escaper != nil { escaper = AmpersandEscaper() }
            return
        }
        context = first.withUnsafeBufferPointer { buffer in
            buffer.withMemoryRebound(to: CChar.self) {
                xmlCreatePushParserCtxt(sax, Unmanaged.passUnretained(self).toOpaque(), $0.baseAddress, Int32($0.count), nil)
            }
        }
        if let context {
            // RECOVER keeps going past a bad entity; HUGE lifts the text-node cap; NONET never fetches a DTD.
            let options = XML_PARSE_RECOVER.rawValue | XML_PARSE_NONET.rawValue | XML_PARSE_HUGE.rawValue | XML_PARSE_NOCDATA.rawValue
            xmlCtxtUseOptions(context, Int32(options))
        }
    }

    private func escaped(_ bytes: UnsafeRawBufferPointer, flush: Bool, _ body: (UnsafeRawBufferPointer) -> Void) {
        if escaper != nil {
            escaper!.filter(bytes, flush: flush, emit: body)
        } else {
            body(bytes)
        }
    }

    private func parse(_ bytes: UnsafeRawBufferPointer, last: Bool) {
        guard let context else { return }
        xmlParseChunk(context, bytes.baseAddress?.assumingMemoryBound(to: CChar.self), Int32(bytes.count), last ? 1 : 0)
    }

    // MARK: SAX events

    private func start(_ name: UnsafePointer<xmlChar>, _ count: Int, _ attributes: UnsafeMutablePointer<UnsafePointer<xmlChar>?>?) {
        if skipping { return }
        if field != .none {
            fieldDepth += 1
            return
        }
        if named(name, "programme") {
            let startMs = attribute("start", count, attributes).flatMap(Self.parseDate)
            let stopMs = attribute("stop", count, attributes).flatMap(Self.parseDate)
            guard let startMs, let channelId = attribute("channel", count, attributes).map(Self.string), !channelId.isEmpty,
                  window?.overlaps(start: startMs, stop: stopMs) ?? true
            else {
                skipping = true
                skipped += 1
                return
            }
            programme = GuideProgramme(channel: channelId, start: startMs, stop: stopMs)
        } else if named(name, "channel") {
            channel = GuideChannel(id: attribute("id", count, attributes).map(Self.string) ?? "")
        } else if named(name, "title") {
            collect(.title)
        } else if named(name, "desc") {
            collect(.desc)
        } else if named(name, "category") {
            collect(.category)
        } else if named(name, "sub-title") {
            collect(.subTitle)
        } else if named(name, "episode-num") {
            episodeSystem = attribute("system", count, attributes).map(Self.string)
            collect(.episodeNum)
        } else if named(name, "display-name") {
            collect(.displayName)
        } else if named(name, "icon") {
            let src = attribute("src", count, attributes).map(Self.string)
            if programme != nil {
                if programme?.icon == nil { programme?.icon = src }
            } else if channel != nil, channel?.icon == nil {
                channel?.icon = src
            }
        } else if named(name, "rating") {
            inRating = true
        } else if named(name, "value") {
            if inRating { collect(.ratingValue) }
        } else if named(name, "new") {
            programme?.isNew = true
        } else if named(name, "previously-shown") {
            programme?.previouslyShown = true
        }
    }

    private func end(_ name: UnsafePointer<xmlChar>) {
        if skipping {
            if named(name, "programme") { skipping = false }
            return
        }
        if field != .none {
            if fieldDepth > 0 {
                fieldDepth -= 1
                return
            }
            let value = String(decoding: text, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            store(field, value)
            field = .none
            return
        }
        if named(name, "programme") {
            if let programme {
                programmes += 1
                onProgramme?(programme)
            }
            programme = nil
        } else if named(name, "channel") {
            if let channel {
                channels += 1
                onChannel?(channel)
            }
            channel = nil
        } else if named(name, "rating") {
            inRating = false
        }
    }

    private func characters(_ bytes: UnsafePointer<xmlChar>, _ length: Int) {
        guard field != .none, !skipping, text.count < Self.fieldCap else { return }
        text.append(contentsOf: UnsafeBufferPointer(start: bytes, count: min(length, Self.fieldCap - text.count)))
    }

    private func collect(_ next: Field) {
        field = next
        fieldDepth = 0
        text.removeAll(keepingCapacity: true)
    }

    private func store(_ field: Field, _ value: String) {
        guard !value.isEmpty else { return }
        switch field {
        case .displayName: channel?.displayNames.append(value)
        case .title: if programme?.title.isEmpty == true { programme?.title = value }
        case .subTitle: if programme?.subTitle == nil { programme?.subTitle = value }
        case .desc: if programme?.desc == nil { programme?.desc = value }
        case .category: programme?.categories.append(value)
        case .episodeNum: programme?.episodeNumbers.append(GuideEpisodeNumber(system: episodeSystem, value: value))
        case .ratingValue: if programme?.rating == nil { programme?.rating = value }
        case .none: break
        }
    }

    // MARK: Helpers

    private func named(_ name: UnsafePointer<xmlChar>, _ literal: StaticString) -> Bool {
        strcmp(UnsafeRawPointer(name).assumingMemoryBound(to: CChar.self), UnsafeRawPointer(literal.utf8Start).assumingMemoryBound(to: CChar.self)) == 0
    }

    /// SAX2 hands attributes as five pointers each: name, prefix, URI, value start, value end.
    private func attribute(_ key: StaticString, _ count: Int, _ attributes: UnsafeMutablePointer<UnsafePointer<xmlChar>?>?) -> UnsafeBufferPointer<UInt8>? {
        guard let attributes else { return nil }
        for index in 0 ..< count {
            let base = index * 5
            guard let name = attributes[base], named(name, key), let start = attributes[base + 3], let end = attributes[base + 4] else { continue }
            return UnsafeBufferPointer(start: start, count: end - start)
        }
        return nil
    }

    /// Without entity substitution libxml2 keeps `&` in attribute values escaped as `&#38;`.
    private static func string(_ bytes: UnsafeBufferPointer<UInt8>) -> String {
        let value = String(decoding: bytes, as: UTF8.self)
        return bytes.contains(0x26) ? value.replacingOccurrences(of: "&#38;", with: "&") : value
    }

    /// `YYYYMMDDhhmmss +hhmm`: any leading run of the digits, zone optional (UTC when absent).
    static func parseDate(_ bytes: UnsafeBufferPointer<UInt8>) -> Int64? {
        var fields = [Int](repeating: 0, count: 6)
        let widths = [4, 2, 2, 2, 2, 2]
        var index = 0
        var parsed = 0
        for (slot, width) in widths.enumerated() {
            var value = 0
            var taken = 0
            while taken < width, index < bytes.count, (48 ... 57).contains(bytes[index]) {
                value = value * 10 + Int(bytes[index] - 48)
                index += 1
                taken += 1
            }
            if taken == 0 { break }
            guard taken == width else { return nil }
            fields[slot] = value
            parsed += 1
        }
        guard parsed > 0 else { return nil }
        if parsed < 2 { fields[1] = 1 }
        if parsed < 3 { fields[2] = 1 }
        guard (1 ... 12).contains(fields[1]), (1 ... 31).contains(fields[2]), fields[3] < 24, fields[4] < 60, fields[5] <= 60 else { return nil }
        var seconds = daysFromCivil(fields[0], fields[1], fields[2]) * 86400 + fields[3] * 3600 + fields[4] * 60 + fields[5]
        while index < bytes.count, bytes[index] == 32 { index += 1 }
        if index < bytes.count, bytes[index] == 43 || bytes[index] == 45 {
            let sign = bytes[index] == 45 ? -1 : 1
            index += 1
            var digits: [Int] = []
            while index < bytes.count, digits.count < 4 {
                let byte = bytes[index]
                if (48 ... 57).contains(byte) { digits.append(Int(byte - 48)) } else if byte != 58 { break }
                index += 1
            }
            guard digits.count == 4 else { return nil }
            let offsetMinutes = (digits[0] * 10 + digits[1]) * 60 + digits[2] * 10 + digits[3]
            seconds -= sign * offsetMinutes * 60
        }
        return Int64(seconds) * 1000
    }

    /// Days since 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's algorithm).
    static func daysFromCivil(_ year: Int, _ month: Int, _ day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }
}
