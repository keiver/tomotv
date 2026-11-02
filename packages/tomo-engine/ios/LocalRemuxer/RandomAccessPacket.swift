//
//  RandomAccessPacket.swift
//  TomoTV
//
//  Whether a video packet opens on a keyframe, read from its NAL units: the keyframe a seek opens
//  on when the container's sync table did not list it.
//

import Foundation
import Libavcodec

enum RandomAccessPacket {
    /// The NAL length prefix an avcC or hvcC declares (the low two bits of its length byte, plus one); nil for Annex B extradata.
    static func lengthSize(_ par: UnsafeMutablePointer<AVCodecParameters>) -> Int? {
        guard let extradata = par.pointee.extradata else { return nil }
        let size = Int(par.pointee.extradata_size)
        if par.pointee.codec_id == AV_CODEC_ID_HEVC, size >= 23,
           extradata[0] == 1 || (extradata[0] == 0 && (extradata[1] != 0 || extradata[2] > 1)) {
            return Int(extradata[21] & 3) + 1
        }
        if par.pointee.codec_id == AV_CODEC_ID_H264, size >= 7, extradata[0] == 1 { return Int(extradata[4] & 3) + 1 }
        return nil
    }

    static func opens(_ pkt: UnsafeMutablePointer<AVPacket>, hevc: Bool, lengthSize: Int?) -> Bool {
        guard let base = pkt.pointee.data, pkt.pointee.size > 0 else { return false }
        return opens(UnsafeRawBufferPointer(start: base, count: Int(pkt.pointee.size)), hevc: hevc, lengthSize: lengthSize)
    }

    /// The first VCL NAL decides: H.264 type 5 (IDR), HEVC types 16 to 21 (BLA, IDR and CRA, the IRAP
    /// types FFmpeg's HEVC parser flags a keyframe by). Length-prefixed by `lengthSize`, Annex B for nil.
    static func opens(_ data: UnsafeRawBufferPointer, hevc: Bool, lengthSize: Int?) -> Bool {
        if let lengthSize, !(1...4).contains(lengthSize) { return false }
        var at = 0
        var seen = 0
        while at < data.count, seen < 64 {
            let nalStart: Int
            let nalEnd: Int
            if let lengthSize {
                guard at + lengthSize < data.count else { return false }
                var length = 0
                for offset in 0 ..< lengthSize { length = length << 8 | Int(data[at + offset]) }
                guard length > 0 else { return false }
                nalStart = at + lengthSize
                nalEnd = min(data.count, nalStart + length)
            } else {
                let code = startCodeLength(data, at: at)
                guard code > 0, at + code < data.count else { return false }
                nalStart = at + code
                nalEnd = nextStartCode(data, from: nalStart) ?? data.count
            }
            let type = hevc ? Int(data[nalStart] >> 1) & 0x3F : Int(data[nalStart] & 0x1F)
            let vcl = hevc ? type < 32 : (1...5).contains(type)
            if vcl { return hevc ? (16...21).contains(type) : type == 5 }
            at = nalEnd
            seen += 1
        }
        return false
    }

    /// 3 or 4 for a start code at `at`, else 0.
    private static func startCodeLength(_ data: UnsafeRawBufferPointer, at: Int) -> Int {
        guard at + 3 <= data.count, data[at] == 0, data[at + 1] == 0 else { return 0 }
        if data[at + 2] == 1 { return 3 }
        if at + 4 <= data.count, data[at + 2] == 0, data[at + 3] == 1 { return 4 }
        return 0
    }

    private static func nextStartCode(_ data: UnsafeRawBufferPointer, from: Int) -> Int? {
        var at = from
        while at + 3 <= data.count {
            if startCodeLength(data, at: at) > 0 { return at }
            at += 1
        }
        return nil
    }
}
