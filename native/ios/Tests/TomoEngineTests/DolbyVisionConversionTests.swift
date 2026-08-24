import Foundation
import Libavcodec
import Libavutil
import XCTest

@testable import TomoEngine

/// Profile 7 to 8.1 conversion, checked against dovi_tool's own committed output.
///
/// Both cases matter and they differ: MEL carries identity curves, FEL carries real MMR curves
/// with constants. Mode 2 leaves both alone, so a conversion that quietly flattened FEL's
/// mapping would still pass a MEL-only test.
final class DolbyVisionConversionTests: XCTestCase {
    private var fixtures: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dolbyvision-rpu")
    }

    /// dovi_tool stores each RPU as a 4-byte start code followed by the escaped payload.
    private func rpuPayload(_ name: String) throws -> [UInt8] {
        let data = try Data(contentsOf: fixtures.appendingPathComponent(name))
        let bytes = [UInt8](data)
        guard bytes.count > 4 else { throw XCTSkip("fixture \(name) is empty") }
        var start = 0
        while start + 4 <= bytes.count {
            if bytes[start] == 0, bytes[start + 1] == 0, bytes[start + 2] == 0, bytes[start + 3] == 1 { break }
            start += 1
        }
        return Array(bytes[(start + 4)...])
    }

    /// Parse an escaped RPU the way the engine's converter does, for comparison.
    private func parse(_ escaped: [UInt8], assumingProfile profile: UInt8) -> DOVIContext? {
        var rbsp: [UInt8] = []
        var i = 0
        while i < escaped.count {
            if i + 2 < escaped.count, escaped[i] == 0, escaped[i + 1] == 0, escaped[i + 2] == 3 {
                rbsp.append(0); rbsp.append(0); i += 3
            } else {
                rbsp.append(escaped[i]); i += 1
            }
        }
        var ctx = DOVIContext()
        ctx.cfg.dv_profile = profile
        ctx.cfg.rpu_present_flag = 1
        ctx.cfg.bl_present_flag = 1
        ctx.cfg.el_present_flag = profile == 7 ? 1 : 0
        let ok = rbsp.withUnsafeBufferPointer { ff_dovi_rpu_parse(&ctx, $0.baseAddress, rbsp.count, 0) }
        return ok >= 0 ? ctx : nil
    }

    private func assertMatchesReference(source: String, reference: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let payload = try rpuPayload(source)
        let converter = DolbyVisionConverter()
        guard let converted = payload.withUnsafeBufferPointer({ buf -> [UInt8]? in
            guard let base = buf.baseAddress else { return nil }
            return converter.convertProfile7ToProfile81(base, buf.count)
        }) else {
            return XCTFail("\(source): converter declined a profile 7 RPU", file: file, line: line)
        }

        guard var ours = parse(converted, assumingProfile: 8) else {
            return XCTFail("\(source): our own output does not parse back", file: file, line: line)
        }
        guard var theirs = parse(try rpuPayload(reference), assumingProfile: 8) else {
            return XCTFail("\(reference): reference does not parse", file: file, line: line)
        }
        defer { ff_dovi_ctx_unref(&ours); ff_dovi_ctx_unref(&theirs) }

        XCTAssertEqual(ff_dovi_guess_profile_hevc(&ours.header), 8, "\(source): not profile 8", file: file, line: line)
        XCTAssertEqual(ours.header.el_spatial_resampling_filter_flag, theirs.header.el_spatial_resampling_filter_flag, file: file, line: line)
        XCTAssertEqual(ours.header.disable_residual_flag, theirs.header.disable_residual_flag, file: file, line: line)
        XCTAssertEqual(ours.header.vdr_rpu_profile, theirs.header.vdr_rpu_profile, file: file, line: line)
        XCTAssertEqual(ours.header.coef_log2_denom, theirs.header.coef_log2_denom, file: file, line: line)
        XCTAssertEqual(ours.header.bl_bit_depth, theirs.header.bl_bit_depth, file: file, line: line)
        XCTAssertEqual(ours.header.vdr_bit_depth, theirs.header.vdr_bit_depth, file: file, line: line)

        guard let mineMapping = ours.mapping, let theirsMapping = theirs.mapping else {
            return XCTFail("\(source): mapping missing", file: file, line: line)
        }
        XCTAssertEqual(mineMapping.pointee.nlq_method_idc, AV_DOVI_NLQ_NONE, "\(source): NLQ survived", file: file, line: line)
        XCTAssertEqual(mineMapping.pointee.nlq_method_idc, theirsMapping.pointee.nlq_method_idc, file: file, line: line)

        // The curves are what a careless conversion loses, so they are compared piece by piece.
        for component in 0..<3 {
            let a = withUnsafePointer(to: mineMapping.pointee.curves) { curves in
                curves.withMemoryRebound(to: AVDOVIReshapingCurve.self, capacity: 3) { $0[component] }
            }
            let b = withUnsafePointer(to: theirsMapping.pointee.curves) { curves in
                curves.withMemoryRebound(to: AVDOVIReshapingCurve.self, capacity: 3) { $0[component] }
            }
            XCTAssertEqual(a.num_pivots, b.num_pivots, "\(source): curve \(component) pivot count", file: file, line: line)
            var ap = a.pivots, bp = b.pivots
            let pivotsEqual = withUnsafeBytes(of: &ap) { x in withUnsafeBytes(of: &bp) { y in x.elementsEqual(y) } }
            XCTAssertTrue(pivotsEqual, "\(source): curve \(component) pivots", file: file, line: line)
            var ac = a.poly_coef, bc = b.poly_coef
            let polyEqual = withUnsafeBytes(of: &ac) { x in withUnsafeBytes(of: &bc) { y in x.elementsEqual(y) } }
            XCTAssertTrue(polyEqual, "\(source): curve \(component) polynomial coefficients", file: file, line: line)
            var am = a.mmr_constant, bm = b.mmr_constant
            let mmrEqual = withUnsafeBytes(of: &am) { x in withUnsafeBytes(of: &bm) { y in x.elementsEqual(y) } }
            XCTAssertTrue(mmrEqual, "\(source): curve \(component) MMR constants", file: file, line: line)
        }
    }

    func testConvertsMinimalEnhancementLayerToProfile81() throws {
        try assertMatchesReference(source: "mel_orig.bin", reference: "mel_to_81.bin")
    }

    func testConvertsFullEnhancementLayerAndKeepsItsMappingCurves() throws {
        try assertMatchesReference(source: "fel_orig.bin", reference: "fel_to_81.bin")
    }

    /// One length-prefixed NAL: 4-byte length, 2-byte HEVC header, payload.
    private func nal(type: UInt8, layerId: Int = 0, payload: [UInt8]) -> [UInt8] {
        let byte0 = (type << 1) | UInt8((layerId >> 5) & 1)
        let byte1 = UInt8(((layerId & 0x1F) << 3) | 1)  // nuh_temporal_id_plus1 = 1
        let size = payload.count + 2
        var out: [UInt8] = []
        for i in (0..<4).reversed() { out.append(UInt8((size >> (8 * i)) & 0xFF)) }
        out.append(byte0)
        out.append(byte1)
        out.append(contentsOf: payload)
        return out
    }

    private func rewrite(_ packet: [UInt8]) -> DolbyVisionConverter.PacketRewrite? {
        let converter = DolbyVisionConverter()
        return packet.withUnsafeBufferPointer { buf in
            guard let base = buf.baseAddress else { return nil }
            return converter.rewritePacket(base, buf.count, lengthSize: 4)
        }
    }

    /// A real access unit: parameter sets, a slice, then the RPU that trails it.
    func testRewritesTheRpuAndLeavesEveryOtherNalAlone() throws {
        let slice: [UInt8] = [0xAA, 0xBB, 0xCC, 0xDD]
        let vps: [UInt8] = [0x01, 0x02]
        let packet = nal(type: 32, payload: vps) + nal(type: 1, payload: slice)
            + nal(type: 62, payload: try rpuPayload("fel_orig.bin"))

        guard let result = rewrite(packet) else { return XCTFail("packet rejected") }
        XCTAssertTrue(result.changed)
        // The untouched NALs must survive byte for byte, at the front, in order.
        let untouched = nal(type: 32, payload: vps) + nal(type: 1, payload: slice)
        XCTAssertEqual(Array(result.data.prefix(untouched.count)), untouched)
        // And what follows must be an RPU the engine now reads as profile 8.
        let converted = Array(result.data.dropFirst(untouched.count + 6))
        guard var parsed = parse(converted, assumingProfile: 8) else { return XCTFail("rewritten RPU does not parse") }
        defer { ff_dovi_ctx_unref(&parsed) }
        XCTAssertEqual(ff_dovi_guess_profile_hevc(&parsed.header), 8)
    }

    /// The enhancement layer has to go: profile 8.1 is single layer by definition.
    func testDropsEnhancementLayerNals() throws {
        let base = nal(type: 1, payload: [0x11, 0x22])
        let enhancement = nal(type: 1, layerId: 1, payload: [0x33, 0x44, 0x55])
        guard let result = rewrite(base + enhancement) else { return XCTFail("packet rejected") }
        XCTAssertTrue(result.changed)
        XCTAssertEqual(result.data, base, "the enhancement layer survived")
    }

    /// A packet with nothing to do comes back unchanged, so the copy path can skip the rewrite.
    func testReportsNoChangeForAnOrdinaryPacket() throws {
        let packet = nal(type: 1, payload: [0x01, 0x02, 0x03])
        guard let result = rewrite(packet) else { return XCTFail("packet rejected") }
        XCTAssertFalse(result.changed)
        XCTAssertEqual(result.data, packet)
    }

    /// A truncated packet is refused rather than silently shortened into a broken frame.
    func testRefusesAMalformedPacket() throws {
        let packet = Array((nal(type: 1, payload: [0x01, 0x02, 0x03])).dropLast(2))
        XCTAssertNil(rewrite(packet))
    }

    /// Split an Annex B stream and re-emit it as one 4-byte length-prefixed buffer, which is the
    /// shape MP4 and Matroska hand the copy path.
    private func lengthPrefixed(_ annexB: [UInt8]) -> [UInt8] {
        // Each NAL ends where the next start code begins, not where the next payload begins.
        var nals: [(code: Int, payload: Int)] = []
        var i = 0
        while i + 3 < annexB.count {
            if annexB[i] == 0, annexB[i + 1] == 0, annexB[i + 2] == 0, annexB[i + 3] == 1 {
                nals.append((i, i + 4)); i += 4
            } else if annexB[i] == 0, annexB[i + 1] == 0, annexB[i + 2] == 1 {
                nals.append((i, i + 3)); i += 3
            } else {
                i += 1
            }
        }
        var out: [UInt8] = []
        for (n, nal) in nals.enumerated() {
            let end = n + 1 < nals.count ? nals[n + 1].code : annexB.count
            let size = end - nal.payload
            guard size >= 2 else { continue }
            for shift in (0..<4).reversed() { out.append(UInt8((size >> (8 * shift)) & 0xFF)) }
            out.append(contentsOf: annexB[nal.payload..<end])
        }
        return out
    }

    private func nalTypes(_ buffer: [UInt8]) -> [UInt8] {
        var types: [UInt8] = []
        var offset = 0
        while offset + 4 <= buffer.count {
            var size = 0
            for i in 0..<4 { size = (size << 8) | Int(buffer[offset + i]) }
            guard size >= 2, offset + 4 + size <= buffer.count else { break }
            types.append((buffer[offset + 4] >> 1) & 0x3F)
            offset += 4 + size
        }
        return types
    }

    /// A real dual-layer stream: 259 RPUs and 795 enhancement-layer NALs from dovi_tool.
    ///
    /// This is the enhancement-layer guard, not a conversion test. The EL is not carried by
    /// `nuh_layer_id`, it is NAL type 63 on layer 0 (hevcdec.c:3670), which no hand-built packet
    /// here caught. Its RPUs are profile 8, so they pass through untouched and the conversion
    /// itself stays pinned by the fel/mel fixtures above.
    func testDropsTheEnhancementLayerOfARealDualLayerStream() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dolbyvision-p7-dual-layer.hevc")
        let packet = lengthPrefixed([UInt8](try Data(contentsOf: url)))

        let before = nalTypes(packet)
        XCTAssertGreaterThan(before.filter { $0 == 62 }.count, 0, "fixture carries no RPU")
        XCTAssertGreaterThan(before.filter { $0 == 63 }.count, 0, "fixture carries no enhancement layer")

        // Recorded, not assumed: these RPUs are profile 8, so the converter declines every one
        // and the only change this test can observe is the enhancement layer going away.
        var sourceOffset = 0
        var sourceProfiles: [Int32] = []
        while sourceOffset + 4 <= packet.count {
            var size = 0
            for i in 0..<4 { size = (size << 8) | Int(packet[sourceOffset + i]) }
            guard size >= 2, sourceOffset + 4 + size <= packet.count else { break }
            if (packet[sourceOffset + 4] >> 1) & 0x3F == 62 {
                let payload = Array(packet[(sourceOffset + 6)..<(sourceOffset + 4 + size)])
                if var parsed = parse(payload, assumingProfile: 8) {
                    sourceProfiles.append(ff_dovi_guess_profile_hevc(&parsed.header))
                    ff_dovi_ctx_unref(&parsed)
                }
            }
            sourceOffset += 4 + size
        }
        XCTAssertFalse(sourceProfiles.isEmpty, "no source RPU parsed")
        XCTAssertEqual(Set(sourceProfiles), [8], "fixture profile changed")

        guard let result = rewrite(packet) else { return XCTFail("real stream rejected") }
        XCTAssertTrue(result.changed)

        let after = nalTypes(result.data)
        XCTAssertEqual(after.filter { $0 == 63 }.count, 0, "the enhancement layer survived")
        XCTAssertEqual(after.filter { $0 == 62 }.count, before.filter { $0 == 62 }.count,
                       "RPUs went missing")
        // Everything that is neither RPU nor enhancement layer is carried through untouched.
        XCTAssertEqual(after.filter { $0 != 62 }, before.filter { $0 != 62 && $0 != 63 })

        // And every surviving RPU still parses, so dropping the EL did not disturb them.
        var offset = 0, checked = 0
        while offset + 4 <= result.data.count {
            var size = 0
            for i in 0..<4 { size = (size << 8) | Int(result.data[offset + i]) }
            guard size >= 2, offset + 4 + size <= result.data.count else { break }
            if (result.data[offset + 4] >> 1) & 0x3F == 62 {
                let payload = Array(result.data[(offset + 6)..<(offset + 4 + size)])
                guard var parsed = parse(payload, assumingProfile: 8) else {
                    return XCTFail("rewritten RPU \(checked) does not parse")
                }
                XCTAssertEqual(ff_dovi_guess_profile_hevc(&parsed.header), 8, "RPU \(checked)")
                ff_dovi_ctx_unref(&parsed)
                checked += 1
            }
            offset += 4 + size
        }
        XCTAssertGreaterThan(checked, 0)
    }

    /// Every RPU from a real profile 7 UHD source, not dovi_tool's synthetic pair.
    ///
    /// The reference fixtures are 256x144 test clips. These twelve come off a 4K disc rip at
    /// dv_level 6 with bl_signal_compatibility_id 6, which is the shape an actual library holds,
    /// and they exercise the converter against metadata nobody wrote for a test suite.
    func testConvertsEveryRpuFromARealProfile7Source() throws {
        let data = try Data(contentsOf: fixtures.appendingPathComponent("p7_real_disc.bin"))
        let bytes = [UInt8](data)

        // Length-prefixed rather than start-code delimited: an RPU can contain 00 00 00 01.
        var payloads: [[UInt8]] = []
        var offset = 0
        while offset + 4 <= bytes.count {
            var size = 0
            for i in 0..<4 { size = (size << 8) | Int(bytes[offset + i]) }
            guard size > 0, offset + 4 + size <= bytes.count else { break }
            payloads.append(Array(bytes[(offset + 4)..<(offset + 4 + size)]))
            offset += 4 + size
        }
        XCTAssertEqual(offset, bytes.count, "fixture is truncated")
        XCTAssertEqual(payloads.count, 12, "fixture RPU count changed")

        let converter = DolbyVisionConverter()
        for (n, payload) in payloads.enumerated() {
            XCTAssertEqual(payload.first, 0x19, "RPU \(n) has no rpu_nal_prefix")

            guard var source = parse(payload, assumingProfile: 7) else {
                return XCTFail("RPU \(n) does not parse")
            }
            XCTAssertEqual(ff_dovi_guess_profile_hevc(&source.header), 7, "RPU \(n) is not profile 7")
            ff_dovi_ctx_unref(&source)

            guard let converted = payload.withUnsafeBufferPointer({ buf -> [UInt8]? in
                guard let base = buf.baseAddress else { return nil }
                return converter.convertProfile7ToProfile81(base, buf.count)
            }) else {
                return XCTFail("RPU \(n) declined")
            }
            guard var result = parse(converted, assumingProfile: 8) else {
                return XCTFail("RPU \(n) does not parse back")
            }
            defer { ff_dovi_ctx_unref(&result) }
            XCTAssertEqual(ff_dovi_guess_profile_hevc(&result.header), 8, "RPU \(n) is not profile 8")
            XCTAssertEqual(result.header.disable_residual_flag, 1, "RPU \(n) still signals residuals")
            XCTAssertEqual(result.header.el_spatial_resampling_filter_flag, 0, "RPU \(n) still signals an EL")
            XCTAssertEqual(result.mapping?.pointee.nlq_method_idc, AV_DOVI_NLQ_NONE, "RPU \(n) kept its NLQ")
        }
    }

    /// A source already at 8.1 must fall straight through, or a second pass would corrupt it.
    func testDeclinesAnRpuThatIsAlreadyProfile81() throws {
        let payload = try rpuPayload("mel_to_81.bin")
        let converter = DolbyVisionConverter()
        let converted = payload.withUnsafeBufferPointer { buf -> [UInt8]? in
            guard let base = buf.baseAddress else { return nil }
            return converter.convertProfile7ToProfile81(base, buf.count)
        }
        XCTAssertNil(converted, "an 8.1 RPU was converted a second time")
    }
}
