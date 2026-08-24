//
//  DolbyVisionConverter.swift
//  TomoTV
//
//  Rewrites a Dolby Vision profile 7 RPU as profile 8.1.
//

import Foundation
import Libavcodec
import Libavutil

/// Apple decodes no dual-layer Dolby Vision. A profile 7 disc remux therefore reaches the panel
/// as plain HDR10 no matter how the playlist is labelled, which is most of what a UHD library
/// holds. Converting its RPU to single-layer 8.1 is what makes the Dolby Vision path engage.
///
/// The transformation was read off dovi_tool's own committed output rather than a description
/// of it: dumping `fel_orig`/`mel_orig` beside `fel_to_81`/`mel_to_81` shows the mapping curves,
/// colour metadata and extension blocks carry across untouched, MMR constants included, and
/// exactly four fields change. Both cases are pinned in DolbyVisionConversionTests.
///
/// The base layer is not re-encoded. Only the metadata NAL is rewritten, so a converted session
/// still costs what a stream copy costs.
final class DolbyVisionConverter {
    /// Reused across frames: every frame carries an RPU, and the context owns refcounted
    /// mapping state that parsing repopulates.
    private var context = DOVIContext()
    /// Scratch for the unescaped payload, grown to the largest RPU seen.
    private var rbsp: [UInt8] = []

    deinit {
        ff_dovi_ctx_unref(&context)
    }

    /// Convert one RPU NAL payload, or nil when it is not a profile 7 this can rewrite.
    ///
    /// `payload` starts at the RPU's own `rpu_nal_prefix` (0x19), which is what follows the two
    /// byte HEVC NAL header, and carries emulation prevention bytes as it does in the bitstream.
    /// The returned bytes are in the same form and drop straight back into the stream.
    func convertProfile7ToProfile81(_ payload: UnsafePointer<UInt8>, _ size: Int) -> [UInt8]? {
        guard size > 0 else { return nil }

        // FFmpeg parses RBSP; the bitstream carries the escaped form.
        if rbsp.count < size { rbsp = [UInt8](repeating: 0, count: size) }
        var rbspCount = 0
        rbsp.withUnsafeMutableBufferPointer { out in
            var i = 0
            while i < size {
                if i + 2 < size, payload[i] == 0, payload[i + 1] == 0, payload[i + 2] == 3 {
                    out[rbspCount] = 0; rbspCount += 1
                    out[rbspCount] = 0; rbspCount += 1
                    i += 3
                } else {
                    out[rbspCount] = payload[i]; rbspCount += 1
                    i += 1
                }
            }
        }

        // Parsed as what it is. The profile is read back from the header, never assumed: a
        // source already at 8.x must fall through untouched.
        context.cfg.dv_profile = 7
        context.cfg.rpu_present_flag = 1
        context.cfg.bl_present_flag = 1
        context.cfg.el_present_flag = 1
        let parsed = rbsp.withUnsafeBufferPointer { ff_dovi_rpu_parse(&context, $0.baseAddress, rbspCount, 0) }
        guard parsed >= 0, ff_dovi_guess_profile_hevc(&context.header) == 7 else { return nil }

        // Single layer: the enhancement layer stops being signalled.
        context.header.el_spatial_resampling_filter_flag = 0
        context.header.disable_residual_flag = 1

        var metadata: UnsafeMutablePointer<AVDOVIMetadata>?
        guard ff_dovi_get_metadata(&context, &metadata) > 0, let metadata else { return nil }
        defer { av_free(metadata) }

        // And its quantisation goes with it. Everything else in the mapping is carried over.
        if let mapping = UnsafeMutablePointer(mutating: av_dovi_get_mapping(metadata)) {
            mapping.pointee.nlq_method_idc = AV_DOVI_NLQ_NONE
            mapping.pointee.nlq_pivots = (0, 0)
            mapping.pointee.nlq = (AVDOVINLQParams(), AVDOVINLQParams(), AVDOVINLQParams())
        }

        context.enable = 1
        context.cfg.dv_profile = 8
        context.cfg.dv_bl_signal_compatibility_id = 1
        context.cfg.el_present_flag = 0

        var out: UnsafeMutablePointer<UInt8>?
        var outSize: Int32 = 0
        // WRAP_NAL emits the prefix and the emulation prevention the bitstream expects.
        guard ff_dovi_rpu_generate(&context, metadata, Int32(FF_DOVI_WRAP_NAL), &out, &outSize) >= 0,
              let out, outSize > 0
        else { return nil }
        defer { av_free(out) }

        return [UInt8](UnsafeBufferPointer(start: out, count: Int(outSize)))
    }

    /// Result of rewriting one access unit.
    struct PacketRewrite {
        let data: [UInt8]
        /// True when anything actually changed, so an untouched packet can be written as-is.
        let changed: Bool
    }

    /// Rewrite one length-prefixed HEVC access unit for single-layer Dolby Vision.
    ///
    /// MP4 and Matroska both carry HEVC as length-prefixed NAL units, so this is the shape the
    /// copy path sees. Dual layer rides one track as two unspecified NAL types, 62 the RPU and 63
    /// the enhancement layer (hevcdec.c:3669, bsf/dovi_rpu.c:87). The RPU is converted and the
    /// enhancement layer is dropped: 8.1 is single layer, and Apple decodes no EL regardless.
    ///
    /// Returns nil when the packet is malformed, which leaves the caller free to pass the
    /// original through rather than truncate a frame.
    func rewritePacket(_ data: UnsafePointer<UInt8>, _ size: Int, lengthSize: Int) -> PacketRewrite? {
        guard lengthSize >= 1, lengthSize <= 4 else { return nil }
        var out: [UInt8] = []
        out.reserveCapacity(size)
        var changed = false
        var offset = 0

        while offset + lengthSize <= size {
            var nalSize = 0
            for i in 0..<lengthSize { nalSize = (nalSize << 8) | Int(data[offset + i]) }
            let payloadStart = offset + lengthSize
            guard nalSize > 0, payloadStart + nalSize <= size else { return nil }

            // HEVC NAL header: type in bits 1..6 of byte 0, nuh_layer_id spanning both bytes.
            guard nalSize >= 2 else { return nil }
            let byte0 = data[payloadStart], byte1 = data[payloadStart + 1]
            let type = (byte0 >> 1) & 0x3F
            let layerId = (Int(byte0 & 1) << 5) | (Int(byte1) >> 3)

            if type == 63 || layerId > 0 {
                // The enhancement layer. Dropped, not converted.
                changed = true
            } else if type == 62, nalSize > 2,
                      let converted = convertProfile7ToProfile81(data + payloadStart + 2, nalSize - 2) {
                let rewritten = converted.count + 2
                for i in (0..<lengthSize).reversed() { out.append(UInt8((rewritten >> (8 * i)) & 0xFF)) }
                out.append(byte0)
                out.append(byte1)
                out.append(contentsOf: converted)
                changed = true
            } else {
                out.append(contentsOf: UnsafeBufferPointer(start: data + offset, count: lengthSize + nalSize))
            }
            offset = payloadStart + nalSize
        }

        guard offset == size else { return nil }
        return PacketRewrite(data: out, changed: changed)
    }
}
