import XCTest
import zlib

@testable import TomoLiveSources

/// Deterministic generator, so a failing fuzz case reproduces from its seed.
struct SplitMix64: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

enum Fixture {
    static let everything = GuideWindow(from: .min, to: .max)

    /// The 75.6 MB epgshare01 US2 guide, when GUIDE_FIXTURE names a local copy of its .xml.gz.
    static func realGuide() throws -> Data {
        try fixture("GUIDE_FIXTURE")
    }

    /// iptv-org's index.m3u (10,919 entries), when PLAYLIST_FIXTURE names a local copy.
    static func realPlaylist() throws -> Data {
        try fixture("PLAYLIST_FIXTURE")
    }

    private static func fixture(_ variable: String) throws -> Data {
        guard let path = ProcessInfo.processInfo.environment[variable], FileManager.default.fileExists(atPath: path) else {
            throw XCTSkip("\(variable) not set")
        }
        return try Data(contentsOf: URL(fileURLWithPath: path))
    }

    static func gzip(_ bytes: [UInt8]) -> [UInt8] {
        var stream = z_stream()
        precondition(deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 16 + MAX_WBITS, 8, Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK)
        defer { deflateEnd(&stream) }
        var input = bytes
        var output = [UInt8](repeating: 0, count: Int(deflateBound(&stream, uLong(bytes.count))) + 64)
        let written = input.withUnsafeMutableBytes { inBuf in
            output.withUnsafeMutableBytes { outBuf -> Int in
                stream.next_in = inBuf.baseAddress?.assumingMemoryBound(to: Bytef.self)
                stream.avail_in = uInt(inBuf.count)
                stream.next_out = outBuf.baseAddress?.assumingMemoryBound(to: Bytef.self)
                stream.avail_out = uInt(outBuf.count)
                precondition(deflate(&stream, Z_FINISH) == Z_STREAM_END)
                return outBuf.count - Int(stream.avail_out)
            }
        }
        return Array(output[..<written])
    }

    static func inflate(_ bytes: [UInt8], chunks: [Int]) throws -> [UInt8] {
        let gunzip = Gunzip()
        var out: [UInt8] = []
        try split(bytes, chunks) { try gunzip.push($0) { out.append(contentsOf: $0) } }
        try gunzip.finish { out.append(contentsOf: $0) }
        return out
    }

    /// Feeds `bytes` in the given chunk sizes, cycling through them.
    static func split(_ bytes: [UInt8], _ chunks: [Int], _ body: (UnsafeRawBufferPointer) throws -> Void) rethrows {
        try bytes.withUnsafeBytes { all in
            var offset = 0
            var step = 0
            while offset < all.count {
                let size = max(1, min(chunks[step % chunks.count], all.count - offset))
                try body(UnsafeRawBufferPointer(rebasing: all[offset ..< offset + size]))
                offset += size
                step += 1
            }
        }
    }

    static func parse(_ bytes: [UInt8], chunks: [Int]? = nil, window: GuideWindow? = nil) -> (store: GuideStore, parser: XmltvParser) {
        let store = GuideStore()
        let parser = XmltvParser(window: window)
        parser.onChannel = { store.add($0) }
        parser.onProgramme = { store.add($0) }
        split(bytes, chunks ?? [bytes.count]) { parser.push($0) }
        parser.finish()
        return (store, parser)
    }

    static func parse(_ text: String, window: GuideWindow? = nil) -> (store: GuideStore, parser: XmltvParser) {
        parse(Array(text.utf8), window: window)
    }

    /// A one-programme document on channel `a.us`.
    static func programme(_ inner: String, attributes: String = #"start="20260925010000 +0000" stop="20260925020000 +0000" channel="a.us""#) -> String {
        #"<?xml version="1.0" encoding="UTF-8"?><tv><programme \#(attributes)>\#(inner)</programme></tv>"#
    }

    static func programmes(_ store: GuideStore, _ channel: String = "a.us") -> [GuideProgramme] {
        store.programmes(channelIds: [channel], window: everything)
    }
}
