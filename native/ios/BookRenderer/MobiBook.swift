//
//  MobiBook.swift
//  TomoTV
//
//  MOBI and KF8 (azw, azw3) files: PalmDOC records decompressed and assembled into HTML
//  chapters, pictures written next to them. Ported from foliate-js mobi.js (MIT,
//  Copyright (c) 2022 John Factotum), string-level, no DOM.
//

import Foundation

final class MobiBook: TextChapters {
    private struct PalmDoc {
        let compression: Int
        let numTextRecords: Int
    }

    private struct MobiHeader {
        let length: Int
        let encoding: Int
        let version: Int
        let titleOffset: Int
        let titleLength: Int
        let resourceStart: Int
        let huffcdic: Int
        let numHuffcdic: Int
        let exthFlag: Int
        let trailingFlags: Int
        let frag: Int
        let skel: Int
    }

    private struct Headers {
        let palmdoc: PalmDoc
        let mobi: MobiHeader
        let exth: [Int: Data]
        let title: Data
    }

    private let data: Data
    private let records: [Range<Int>]
    /// Record offset of the KF8 part in a combined MOBI/KF8 file.
    private var start = 0
    private var headers: Headers
    private let resourceStart: Int
    private let encoding: String.Encoding
    private var decompress: ([UInt8]) -> [UInt8] = { $0 }
    private var multibyte = false
    private var trailingEntries = 0
    private let directory: URL
    private var sections: [String] = []
    private var resourceFiles: [Int: String?] = [:]
    let title: String?

    init(url: URL, directory: URL) throws {
        let bytes = try Data(contentsOf: url)
        data = bytes
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard bytes.count > 78, bytes.ascii(60, 8) == "BOOKMOBI" else { throw BookError.open("Not a MOBI file") }
        let numRecords = bytes.u16(76)
        guard numRecords > 1 else { throw BookError.open("Empty MOBI file") }
        let offsets = (0..<numRecords).map { bytes.u32(78 + $0 * 8) }
        let ranges: [Range<Int>] = offsets.enumerated().map { index, offset in
            let end = index + 1 < offsets.count ? offsets[index + 1] : bytes.count
            return min(offset, bytes.count) ..< min(max(offset, end), bytes.count)
        }
        records = ranges

        headers = try Self.parseHeaders(Self.record(bytes, ranges, 0))
        resourceStart = headers.mobi.resourceStart
        var isKF8 = headers.mobi.version >= 8
        if !isKF8, let boundary = headers.exth[121].map({ $0.u32(0) }), boundary < 0xffff_ffff, boundary < numRecords,
           let kf8 = try? Self.parseHeaders(Self.record(bytes, ranges, boundary)) {
            headers = kf8
            start = boundary
            isKF8 = true
        }

        let textEncoding: String.Encoding = headers.mobi.encoding == 1252 ? .windowsCP1252 : .utf8
        encoding = textEncoding
        let flags = headers.mobi.trailingFlags
        multibyte = flags & 1 != 0
        trailingEntries = (flags >> 1).nonzeroBitCount

        switch headers.palmdoc.compression {
        case 1: decompress = { $0 }
        case 2: decompress = Self.decompressPalmDOC
        case 17480:
            let kf8Start = start
            let huff = try HuffCdic(record: { index in Self.record(bytes, ranges, kf8Start + index) },
                                    first: headers.mobi.huffcdic, count: headers.mobi.numHuffcdic)
            decompress = { huff.decompress($0) }
        default: throw BookError.open("Unknown MOBI compression \(headers.palmdoc.compression)")
        }

        let exthTitle = headers.exth[503].flatMap { String(data: $0, encoding: textEncoding) }
        title = (exthTitle ?? String(data: headers.title, encoding: textEncoding))?.trimmingCharacters(in: .whitespacesAndNewlines)

        sections = isKF8 ? try assembleKF8() : try assembleMobi6()
        guard !sections.isEmpty else { throw BookError.open("This book has no text") }
    }

    var chapterCount: Int { sections.count }

    func chapterHTML(_ index: Int) throws -> (html: String, base: URL) {
        guard sections.indices.contains(index) else { throw BookError.badIndex(index) }
        return (sections[index], directory)
    }

    // MARK: - Records

    private static func record(_ data: Data, _ records: [Range<Int>], _ index: Int) -> Data {
        guard records.indices.contains(index) else { return Data() }
        return data.subdata(in: records[index])
    }

    private func loadRecord(_ index: Int) -> Data { Self.record(data, records, start + index) }

    private func loadText(_ index: Int) -> [UInt8] {
        decompress(removeTrailing([UInt8](loadRecord(index + 1))))
    }

    private func allText() -> [UInt8] {
        var all: [UInt8] = []
        for i in 0..<headers.palmdoc.numTextRecords { all += loadText(i) }
        return all
    }

    private func removeTrailing(_ bytes: [UInt8]) -> [UInt8] {
        var slice = bytes[...]
        for _ in 0..<trailingEntries {
            let length = Self.varLenFromEnd(slice)
            slice = slice.dropLast(min(length, slice.count))
        }
        if multibyte, let last = slice.last {
            slice = slice.dropLast(min(Int(last & 0b11) + 1, slice.count))
        }
        return Array(slice)
    }

    private static func parseHeaders(_ rec: Data) throws -> Headers {
        guard rec.ascii(16, 4) == "MOBI" else { throw BookError.open("Missing MOBI header") }
        let palmdoc = PalmDoc(compression: rec.u16(0), numTextRecords: rec.u16(8))
        let mobi = MobiHeader(length: rec.u32(20), encoding: rec.u32(28), version: rec.u32(36),
                              titleOffset: rec.u32(84), titleLength: rec.u32(88), resourceStart: rec.u32(108),
                              huffcdic: rec.u32(112), numHuffcdic: rec.u32(116), exthFlag: rec.u32(128),
                              trailingFlags: rec.u32(240), frag: rec.u32(248), skel: rec.u32(252))
        var exth: [Int: Data] = [:]
        if mobi.exthFlag & 0x40 != 0 {
            let base = mobi.length + 16
            if rec.ascii(base, 4) == "EXTH" {
                let count = rec.u32(base + 8)
                var offset = base + 12
                for _ in 0..<count {
                    let type = rec.u32(offset), length = rec.u32(offset + 4)
                    guard length >= 8 else { break }
                    exth[type] = rec.sub(offset + 8, length - 8)
                    offset += length
                }
            }
        }
        return Headers(palmdoc: palmdoc, mobi: mobi, exth: exth, title: rec.sub(mobi.titleOffset, mobi.titleLength))
    }

    // MARK: - Decoding

    private func decode(_ bytes: [UInt8]) -> String {
        String(bytes: bytes, encoding: encoding) ?? String(bytes: bytes, encoding: .isoLatin1) ?? String(decoding: bytes, as: UTF8.self)
    }

    /// A resource record written to disk once, by index; nil for fonts, media and unknown bytes.
    private func resourceFile(_ index: Int) -> String? {
        if let cached = resourceFiles[index] { return cached }
        let rec = Self.record(data, records, resourceStart + index)
        var name: String? = nil
        let magic = rec.ascii(0, 4)
        if !rec.isEmpty, magic != "FONT", magic != "VIDE", magic != "AUDI" {
            let ext = BookRender.imageExtension(for: rec)
            if ext != "bin" {
                let file = "res-\(index).\(ext)"
                if (try? rec.write(to: directory.appendingPathComponent(file))) != nil { name = file }
            }
        }
        resourceFiles[index] = name
        return name
    }

    // MARK: - MOBI 6

    private static let pagebreak = try! NSRegularExpression(pattern: "<\\s*(?:mbp:)?pagebreak[^>]*>", options: .caseInsensitive)
    private static let recindex = try! NSRegularExpression(pattern: "recindex\\s*=\\s*[\"']?(\\d+)[\"']?", options: .caseInsensitive)

    private func assembleMobi6() throws -> [String] {
        let all = allText()
        // One byte per character, so match offsets are byte offsets.
        guard let latin = String(bytes: all, encoding: .isoLatin1) else { throw BookError.open("undecodable text") }
        let ns = latin as NSString
        var starts = [0]
        for match in Self.pagebreak.matches(in: latin, range: NSRange(location: 0, length: ns.length)) {
            starts.append(match.range.location)
        }
        var result: [String] = []
        for (i, begin) in starts.enumerated() {
            let end = i + 1 < starts.count ? starts[i + 1] : all.count
            guard end > begin else { continue }
            var html = decode(Array(all[begin..<end]))
            html = Self.pagebreak.stringByReplacingMatches(in: html, range: NSRange(location: 0, length: (html as NSString).length), withTemplate: "")
            html = replace(in: html, regex: Self.recindex) { groups in
                guard let number = Int(groups[1]), let file = self.resourceFile(number - 1) else { return nil }
                return "src=\"\(file)\""
            }
            if html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            result.append(html)
        }
        return result
    }

    // MARK: - KF8

    private static let kindleEmbed = try! NSRegularExpression(pattern: "kindle:embed:([0-9A-Za-z]+)(?:\\?mime=[-+.\\w/]+)?", options: [])

    private func assembleKF8() throws -> [String] {
        let skelData = try indexData(headers.mobi.skel)
        let fragData = try indexData(headers.mobi.frag)
        let frags: [(insertOffset: Int, offset: Int, length: Int)] = fragData.table.map { entry in
            (Int(entry.name) ?? 0, entry.tagMap[6]?.first ?? 0, entry.tagMap[6]?.dropFirst().first ?? 0)
        }
        let all = allText()
        var result: [String] = []
        var cursor = 0
        for skel in skelData.table {
            let numFrag = skel.tagMap[1]?.first ?? 0
            let offset = skel.tagMap[6]?.first ?? 0
            let length = skel.tagMap[6]?.dropFirst().first ?? 0
            let own = Array(frags[min(cursor, frags.count) ..< min(cursor + numFrag, frags.count)])
            cursor += numFrag
            guard !own.isEmpty else { continue }
            let total = length + own.reduce(0) { $0 + $1.length }
            guard offset < all.count else { continue }
            let raw = Array(all[offset ..< min(offset + total, all.count)])
            var skeleton = Array(raw.prefix(length))
            for frag in own {
                let at = max(0, min(frag.insertOffset - offset, skeleton.count))
                let from = length + frag.offset
                guard from <= raw.count else { continue }
                skeleton.insert(contentsOf: raw[from ..< min(from + frag.length, raw.count)], at: at)
            }
            var html = decode(skeleton)
            html = replace(in: html, regex: Self.kindleEmbed) { groups in
                guard let id = Int(groups[1], radix: 32), let file = self.resourceFile(id - 1) else { return nil }
                return file
            }
            result.append(html)
        }
        return result
    }

    private struct IndexEntry {
        let name: String
        let tagMap: [Int: [Int]]
    }

    private func indexData(_ indxIndex: Int) throws -> (table: [IndexEntry], cncx: [Int: String]) {
        guard indxIndex < 0xffff_ffff else { throw BookError.open("KF8 index missing") }
        let indx = loadRecord(indxIndex)
        guard indx.ascii(0, 4) == "INDX" else { throw BookError.open("Invalid INDX record") }
        let headerLength = indx.u32(4), numRecords = indx.u32(24), numCncx = indx.u32(52)
        let tagx = indx.sub(headerLength, indx.count - headerLength)
        guard tagx.ascii(0, 4) == "TAGX" else { throw BookError.open("Invalid TAGX section") }
        let numControlBytes = tagx.u32(8)
        let numTags = max(0, min((tagx.u32(4) - 12) / 4, (tagx.count - 12) / 4))
        let tagTable: [(tag: Int, numValues: Int, mask: Int, end: Int)] = (0..<numTags).map { i in
            (tagx.u8(12 + i * 4), tagx.u8(13 + i * 4), tagx.u8(14 + i * 4), tagx.u8(15 + i * 4))
        }

        var cncx: [Int: String] = [:]
        var cncxOffset = 0
        for i in 0..<min(numCncx, records.count) {
            let rec = loadRecord(indxIndex + numRecords + i + 1)
            let bytes = [UInt8](rec)
            var pos = 0
            while pos < bytes.count {
                let index = pos
                let (value, length) = Self.varLen(bytes, pos)
                pos += length
                cncx[cncxOffset + index] = decode(Array(bytes[min(pos, bytes.count) ..< min(pos + value, bytes.count)]))
                pos += value
            }
            cncxOffset += 0x10000
        }

        var table: [IndexEntry] = []
        for i in 0..<numRecords {
            let rec = loadRecord(indxIndex + 1 + i)
            let bytes = [UInt8](rec)
            guard rec.ascii(0, 4) == "INDX" else { throw BookError.open("Invalid INDX record") }
            let idxt = rec.u32(20), count = min(rec.u32(24), max(0, (rec.count - idxt - 4) / 2))
            for j in 0..<count {
                let offset = rec.u16(idxt + 4 + 2 * j)
                let nameLength = rec.u8(offset)
                let name = String(bytes: rec.sub(offset + 1, nameLength), encoding: .isoLatin1) ?? ""
                let startPos = offset + 1 + nameLength
                var controlByteIndex = 0
                var pos = startPos + numControlBytes
                var tags: [(tag: Int, valueCount: Int?, valueBytes: Int?, numValues: Int)] = []
                for entry in tagTable {
                    if entry.end & 1 != 0 { controlByteIndex += 1; continue }
                    let value = rec.u8(startPos + controlByteIndex) & entry.mask
                    if value == entry.mask {
                        if entry.mask.nonzeroBitCount > 1 {
                            let (v, l) = Self.varLen(bytes, pos)
                            tags.append((entry.tag, nil, v, entry.numValues))
                            pos += l
                        } else {
                            tags.append((entry.tag, 1, nil, entry.numValues))
                        }
                    } else {
                        tags.append((entry.tag, value >> entry.mask.trailingZeroBitCount, nil, entry.numValues))
                    }
                }
                var tagMap: [Int: [Int]] = [:]
                for tag in tags {
                    var values: [Int] = []
                    if let valueCount = tag.valueCount {
                        for _ in 0..<(valueCount * tag.numValues) {
                            let (v, l) = Self.varLen(bytes, pos)
                            values.append(v)
                            pos += l
                        }
                    } else if let valueBytes = tag.valueBytes {
                        var consumed = 0
                        while consumed < valueBytes, pos < bytes.count {
                            let (v, l) = Self.varLen(bytes, pos)
                            values.append(v)
                            pos += l
                            consumed += l
                        }
                    }
                    tagMap[tag.tag] = values
                }
                table.append(IndexEntry(name: name, tagMap: tagMap))
            }
        }
        return (table, cncx)
    }

    // MARK: - Byte helpers

    private static func varLen(_ bytes: [UInt8], _ start: Int) -> (value: Int, length: Int) {
        // Past the end reads as it does at the end; a range starting past its end traps.
        guard start < bytes.count else { return (0, 1) }
        var value = 0, length = 0
        for i in start ..< min(start + 4, bytes.count) {
            value = (value << 7) | Int(bytes[i] & 0x7f)
            length += 1
            if bytes[i] & 0x80 != 0 { break }
        }
        return (value, max(length, 1))
    }

    private static func varLenFromEnd(_ bytes: ArraySlice<UInt8>) -> Int {
        var value = 0
        for byte in bytes.suffix(4) {
            if byte & 0x80 != 0 { value = 0 }
            value = (value << 7) | Int(byte & 0x7f)
        }
        return value
    }

    private static func decompressPalmDOC(_ input: [UInt8]) -> [UInt8] {
        var output: [UInt8] = []
        output.reserveCapacity(input.count * 2)
        var i = 0
        while i < input.count {
            let byte = input[i]
            if byte == 0 {
                output.append(0)
            } else if byte <= 8 {
                // A literal run cut short by the record's end is the end of the text.
                guard i + 1 < input.count else { break }
                let end = min(i + Int(byte), input.count - 1)
                output.append(contentsOf: input[(i + 1) ... end])
                i += Int(byte)
            } else if byte <= 0x7f {
                output.append(byte)
            } else if byte <= 0xbf {
                guard i + 1 < input.count else { break }
                let pair = (Int(byte) << 8) | Int(input[i + 1])
                i += 1
                let distance = (pair & 0x3fff) >> 3
                let length = (pair & 0b111) + 3
                for _ in 0..<length {
                    guard distance > 0, distance <= output.count else { break }
                    output.append(output[output.count - distance])
                }
            } else {
                output.append(32)
                output.append(byte ^ 0x80)
            }
            i += 1
        }
        return output
    }

    private func replace(in text: String, regex: NSRegularExpression, _ replacement: ([String]) -> String?) -> String {
        let ns = text as NSString
        var out = text
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).reversed() {
            let groups = (0..<match.numberOfRanges).map { match.range(at: $0).location == NSNotFound ? "" : ns.substring(with: match.range(at: $0)) }
            guard let value = replacement(groups) else { continue }
            out = (out as NSString).replacingCharacters(in: match.range, with: value)
        }
        return out
    }
}

/// The HUFF/CDIC dictionary compression of newer MOBI files.
private final class HuffCdic {
    private var table1: [(found: Bool, codeLength: Int, value: UInt32)] = []
    private var table2: [(UInt32, UInt32)] = Array(repeating: (0, 0), count: 33)
    private var dictionary: [(bytes: [UInt8], done: Bool)] = []

    init(record: (Int) -> Data, first: Int, count: Int) throws {
        let huff = record(first)
        guard huff.ascii(0, 4) == "HUFF" else { throw BookError.open("Invalid HUFF record") }
        let offset1 = huff.u32(8), offset2 = huff.u32(12)
        table1 = (0..<256).map { i in
            let x = UInt32(huff.u32(offset1 + i * 4))
            return (x & 0x80 != 0, Int(x & 0x1f), x >> 8)
        }
        for i in 0..<32 {
            table2[i + 1] = (UInt32(huff.u32(offset2 + i * 8)), UInt32(huff.u32(offset2 + i * 8 + 4)))
        }
        for i in 1..<max(count, 1) {
            let cdic = record(first + i)
            guard cdic.ascii(0, 4) == "CDIC" else { throw BookError.open("Invalid CDIC record") }
            let length = cdic.u32(4), numEntries = cdic.u32(8), codeLength = cdic.u32(12)
            let buffer = cdic.sub(length, cdic.count - length)
            let n = max(0, min(1 << codeLength, numEntries - dictionary.count, buffer.count / 2))
            for j in 0..<n {
                let offset = buffer.u16(j * 2)
                let x = buffer.u16(offset)
                dictionary.append(([UInt8](buffer.sub(offset + 2, x & 0x7fff)), x & 0x8000 != 0))
            }
        }
    }

    private static func read32(_ bytes: [UInt8], _ from: Int) -> UInt32 {
        let startByte = from >> 3, end = from + 32, endByte = end >> 3
        var bits: UInt64 = 0
        for i in startByte...endByte { bits = (bits << 8) | UInt64(i < bytes.count ? bytes[i] : 0) }
        return UInt32(truncatingIfNeeded: (bits >> UInt64(8 - (end & 7))) & 0xffff_ffff)
    }

    func decompress(_ bytes: [UInt8]) -> [UInt8] {
        var output: [UInt8] = []
        let bitLength = bytes.count * 8
        var i = 0
        while i < bitLength {
            let bits = Self.read32(bytes, i)
            var (found, codeLength, value) = table1[Int(bits >> 24)]
            if !found {
                while codeLength < 32, (bits >> UInt32(32 - codeLength)) < table2[codeLength].0 { codeLength += 1 }
                value = table2[codeLength].1
            }
            guard codeLength > 0 else { break }
            i += codeLength
            if i > bitLength { break }
            let code = Int(value) - Int(bits >> UInt32(32 - codeLength))
            guard dictionary.indices.contains(code) else { break }
            var (result, done) = dictionary[code]
            if !done {
                // Marked before the recursion: an entry that decodes to its own code ends here.
                dictionary[code] = (result, true)
                result = decompress(result)
                dictionary[code] = (result, true)
            }
            output += result
        }
        return output
    }
}

extension Data {
    func u8(_ i: Int) -> Int { i >= 0 && i < count ? Int(self[startIndex + i]) : 0 }
    func u16(_ i: Int) -> Int { (u8(i) << 8) | u8(i + 1) }
    func u32(_ i: Int) -> Int { (u16(i) << 16) | u16(i + 2) }
    func sub(_ i: Int, _ n: Int) -> Data {
        let from = Swift.min(count, Swift.max(0, i)), to = Swift.min(count, from + Swift.max(0, n))
        return subdata(in: (startIndex + from) ..< (startIndex + to))
    }
    func ascii(_ i: Int, _ n: Int) -> String { String(bytes: sub(i, n), encoding: .isoLatin1) ?? "" }
}
