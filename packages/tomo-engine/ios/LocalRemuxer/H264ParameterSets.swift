//
//  H264ParameterSets.swift
//  TomoTV
//
//  Reads frame_mbs_only_flag out of an H.264 SPS, from avcC or Annex B extradata.
//  Live TS leaves codecpar.field_order unknown, so field/MBAFF coding is read
//  from the parameter set itself.
//

import Foundation
import Libavcodec

enum H264ParameterSets {

    /// True when the SPS allows field or MBAFF coding (frame_mbs_only_flag == 0).
    /// Nil when the stream is not H.264, carries no SPS, or the SPS does not parse.
    static func codedInterlaced(_ params: UnsafeMutablePointer<AVCodecParameters>) -> Bool? {
        guard params.pointee.codec_id == AV_CODEC_ID_H264,
              let raw = params.pointee.extradata, params.pointee.extradata_size > 0 else { return nil }
        let data = [UInt8](UnsafeBufferPointer(start: raw, count: Int(params.pointee.extradata_size)))
        guard let sps = spsPayload(in: data) else { return nil }
        return frameMbsOnlyFlag(rbsp: unescaped(sps)).map { $0 == 0 }
    }

    /// The first SPS NAL's payload, past its one-byte header.
    static func spsPayload(in data: [UInt8]) -> ArraySlice<UInt8>? {
        if data.first == 1 {
            // avcC: 5-byte header, SPS count, then 2-byte-length-prefixed NALs.
            guard data.count > 6 else { return nil }
            let count = Int(data[5] & 0x1F)
            var at = 6
            for _ in 0..<count {
                guard at + 2 <= data.count else { return nil }
                let length = Int(data[at]) << 8 | Int(data[at + 1])
                at += 2
                guard length > 1, at + length <= data.count else { return nil }
                if data[at] & 0x1F == 7 { return data[(at + 1)..<(at + length)] }
                at += length
            }
            return nil
        }
        // Annex B: 00 00 01 start codes delimit NALs.
        var i = 0
        while i + 3 < data.count {
            guard data[i] == 0, data[i + 1] == 0, data[i + 2] == 1 else { i += 1; continue }
            let header = i + 3
            if data[header] & 0x1F == 7 {
                var end = data.count
                var j = header + 1
                while j + 2 < data.count {
                    if data[j] == 0, data[j + 1] == 0, data[j + 2] <= 1 { end = j; break }
                    j += 1
                }
                return data[(header + 1)..<end]
            }
            i = header
        }
        return nil
    }

    /// NAL payload with emulation prevention bytes (00 00 03) removed.
    static func unescaped(_ payload: ArraySlice<UInt8>) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(payload.count)
        var zeros = 0
        for byte in payload {
            if zeros >= 2, byte == 3 {
                zeros = 0
                continue
            }
            zeros = byte == 0 ? zeros + 1 : 0
            out.append(byte)
        }
        return out
    }

    /// Walks the SPS (14496-10 7.3.2.1.1) up to frame_mbs_only_flag. Nil on a short or torn SPS.
    static func frameMbsOnlyFlag(rbsp: [UInt8]) -> UInt32? {
        var r = BitReader(rbsp)
        let profile = r.bits(8)
        _ = r.bits(8) // constraint flags + reserved
        _ = r.bits(8) // level_idc
        _ = r.ue() // seq_parameter_set_id
        if [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].contains(profile) {
            let chroma = r.ue()
            if chroma == 3 { _ = r.bit() } // separate_colour_plane_flag
            _ = r.ue() // bit_depth_luma_minus8
            _ = r.ue() // bit_depth_chroma_minus8
            _ = r.bit() // qpprime_y_zero_transform_bypass_flag
            if r.bit() == 1 {
                for index in 0..<(chroma == 3 ? 12 : 8) where r.bit() == 1 {
                    skipScalingList(&r, size: index < 6 ? 16 : 64)
                }
            }
        }
        _ = r.ue() // log2_max_frame_num_minus4
        let pocType = r.ue()
        if pocType == 0 {
            _ = r.ue() // log2_max_pic_order_cnt_lsb_minus4
        } else if pocType == 1 {
            _ = r.bit() // delta_pic_order_always_zero_flag
            _ = r.se() // offset_for_non_ref_pic
            _ = r.se() // offset_for_top_to_bottom_field
            for _ in 0..<r.ue() { _ = r.se() }
        }
        _ = r.ue() // max_num_ref_frames
        _ = r.bit() // gaps_in_frame_num_value_allowed_flag
        _ = r.ue() // pic_width_in_mbs_minus1
        _ = r.ue() // pic_height_in_map_units_minus1
        let flag = r.bit()
        return r.overrun ? nil : flag
    }

    private static func skipScalingList(_ r: inout BitReader, size: Int) {
        var lastScale = 8
        var nextScale = 8
        for _ in 0..<size {
            if nextScale != 0 { nextScale = (lastScale + r.se() + 256) % 256 }
            if nextScale != 0 { lastScale = nextScale }
        }
    }

    /// MSB-first reader; a read past the end sets `overrun` and returns 0.
    struct BitReader {
        private let data: [UInt8]
        private var at = 0
        private(set) var overrun = false

        init(_ data: [UInt8]) { self.data = data }

        mutating func bit() -> UInt32 {
            guard at < data.count * 8 else {
                overrun = true
                return 0
            }
            let value = (data[at >> 3] >> (7 - UInt8(at & 7))) & 1
            at += 1
            return UInt32(value)
        }

        mutating func bits(_ count: Int) -> UInt32 {
            var value: UInt32 = 0
            for _ in 0..<count { value = value << 1 | bit() }
            return value
        }

        /// Exp-Golomb ue(v); a run past 31 zeros is a torn SPS.
        mutating func ue() -> UInt32 {
            var zeros = 0
            while bit() == 0, !overrun {
                zeros += 1
                if zeros > 31 {
                    overrun = true
                    return 0
                }
            }
            guard !overrun else { return 0 }
            return (1 << zeros) - 1 + bits(zeros)
        }

        mutating func se() -> Int {
            let k = ue()
            return k & 1 == 1 ? Int(k >> 1) + 1 : -Int(k >> 1)
        }
    }
}
