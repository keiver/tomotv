import XCTest
@testable import TomoEngine

/// The init segment a server hands back for an HDR source it did not tone-map: avc1 with
/// PQ/BT.2020 colr plus mdcv and clli, which AVFoundation refuses under a master (-12927).
final class InitSegmentSdrTests: XCTestCase {
    private func box(_ type: String, _ payload: Data) -> Data {
        let size = UInt32(payload.count + 8)
        return Data([UInt8(size >> 24), UInt8((size >> 16) & 0xff), UInt8((size >> 8) & 0xff), UInt8(size & 0xff)]) + Data(type.utf8) + payload
    }

    private func colr(_ tags: [UInt8]) -> Data { box("colr", Data("nclx".utf8) + Data(tags) + Data([0])) }
    private let pq: [UInt8] = [0, 9, 0, 16, 0, 9]
    private let bt709: [UInt8] = [0, 1, 0, 1, 0, 1]
    private let avcC = Data([1, 0x64, 0, 0x28, 0xff, 0xe1])

    private func initSegment(entry: String, children: [Data]) -> Data {
        let sample = box(entry, Data(repeating: 0, count: 78) + children.reduce(Data(), +))
        let stsd = box("stsd", Data([0, 0, 0, 0, 0, 0, 0, 1]) + sample)
        let moov = box("moov", box("mvhd", Data(repeating: 0, count: 100)) + box("trak", box("tkhd", Data(repeating: 0, count: 84)) + box("mdia", box("minf", box("stbl", stsd)))))
        return box("ftyp", Data("isom".utf8) + Data([0, 0, 0, 0])) + moov
    }

    /// Top-level boxes of a byte range as (type, whole box), failing on any size that does not fit.
    private func boxes(_ data: Data, from start: Int = 0) -> [(String, Data)] {
        var out: [(String, Data)] = []
        var offset = start
        while offset + 8 <= data.count {
            let size = Int(data[offset]) << 24 | Int(data[offset + 1]) << 16 | Int(data[offset + 2]) << 8 | Int(data[offset + 3])
            XCTAssertGreaterThanOrEqual(size, 8)
            XCTAssertLessThanOrEqual(offset + size, data.count, "box overruns its parent")
            out.append((String(decoding: data[offset + 4 ..< offset + 8], as: UTF8.self), Data(data[offset ..< offset + size])))
            offset += size
        }
        XCTAssertEqual(offset, data.count, "boxes do not tile their parent")
        return out
    }

    private func sampleEntry(in file: Data) -> (String, Data) {
        let moov = boxes(file).first { $0.0 == "moov" }!.1
        let trak = boxes(moov, from: 8).first { $0.0 == "trak" }!.1
        let mdia = boxes(trak, from: 8).first { $0.0 == "mdia" }!.1
        let minf = boxes(mdia, from: 8).first { $0.0 == "minf" }!.1
        let stbl = boxes(minf, from: 8).first { $0.0 == "stbl" }!.1
        let stsd = boxes(stbl, from: 8).first { $0.0 == "stsd" }!.1
        return boxes(stsd, from: 16)[0]
    }

    func testAvc1WithPqColourIsRetaggedAndStrippedOfHdrBoxes() throws {
        let clli = box("clli", Data(repeating: 0, count: 4))
        let mdcv = box("mdcv", Data(repeating: 0, count: 24))
        let original = initSegment(entry: "avc1", children: [box("avcC", avcC), colr(pq), clli, mdcv, box("pasp", Data([0, 0, 0, 1, 0, 0, 0, 1]))])

        let out = try XCTUnwrap(InitSegmentSdr.normalise(original))

        XCTAssertEqual(out.count, original.count - clli.count - mdcv.count)
        XCTAssertEqual(boxes(out).map(\.0), ["ftyp", "moov"])
        let (type, entry) = sampleEntry(in: out)
        XCTAssertEqual(type, "avc1")
        let children = boxes(entry, from: 86)
        XCTAssertEqual(children.map(\.0), ["avcC", "colr", "pasp"])
        XCTAssertEqual([UInt8](children[1].1[12 ..< 18]), bt709)
        XCTAssertEqual(children[0].1, box("avcC", avcC))
    }

    func testHvc1WithPqColourIsRetaggedTheSameWay() throws {
        let original = initSegment(entry: "hvc1", children: [box("hvcC", Data([1, 2])), colr(pq), box("clli", Data(repeating: 0, count: 4))])
        let out = try XCTUnwrap(InitSegmentSdr.normalise(original))
        let (type, entry) = sampleEntry(in: out)
        XCTAssertEqual(type, "hvc1")
        let children = boxes(entry, from: 86)
        XCTAssertEqual(children.map(\.0), ["hvcC", "colr"])
        XCTAssertEqual([UInt8](children[1].1[12 ..< 18]), bt709)
    }

    func testDolbyVisionEntryPassesThroughUntouched() {
        let original = initSegment(entry: "dvh1", children: [box("hvcC", Data([1, 2])), colr(pq), box("clli", Data(repeating: 0, count: 4))])
        XCTAssertNil(InitSegmentSdr.normalise(original))
    }

    func testSdrAvc1NeedsNothing() {
        XCTAssertNil(InitSegmentSdr.normalise(initSegment(entry: "avc1", children: [box("avcC", avcC), colr(bt709)])))
    }

    func testAvc1WithoutColrLosesOnlyItsHdrBoxes() throws {
        let original = initSegment(entry: "avc1", children: [box("avcC", avcC), box("mdcv", Data(repeating: 0, count: 24))])
        let out = try XCTUnwrap(InitSegmentSdr.normalise(original))
        XCTAssertEqual(boxes(sampleEntry(in: out).1, from: 86).map(\.0), ["avcC"])
    }
}
