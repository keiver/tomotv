//
//  DeviceDecode.swift
//  TomoTV
//
//  What THIS device's VideoToolbox will decode, asked rather than assumed. A
//  codec name says nothing about profile support: an Apple TV HD has no HEVC
//  decoder at all, and a stream copied to AVPlayer there fails with no lane to
//  fall back from. The answer decides whether HEVC is copied or re-encoded,
//  and which profile the engine's own encoder may emit.
//
//  A decompression session is the only honest test. Measured on macOS: a bare
//  HEVC format with no parameter sets fails (-8971) on hardware that decodes
//  HEVC, and a record with empty parameter-set arrays is rejected (-4), so the
//  probe needs real VPS/SPS/PPS. The canned records below are the parameter
//  sets of two one-frame x265 encodes, Main and Main 10, with the SEI stripped.
//

import CoreMedia
import Foundation
import Libavcodec
import Libavformat
import Libavutil
import VideoToolbox

enum DeviceDecode {

    /// Opens a session for the stream's own parameter sets. Cached per record: a
    /// library of files from one encoder asks once.
    static func canDecode(stream: UnsafeMutablePointer<AVStream>) -> Bool {
        guard let par = stream.pointee.codecpar else { return false }
        switch par.pointee.codec_id {
        case AV_CODEC_ID_H264: return true
        case AV_CODEC_ID_AV1: return av1Hardware
        case AV_CODEC_ID_HEVC: break
        default: return false
        }
        let byProfile = par.pointee.profile == Int32(AV_PROFILE_HEVC_MAIN_10) ? hevcMain10 : hevc
        // Annex B extradata (raw .h265, MPEG-TS) carries no hvcC box; the profile class answers.
        guard let raw = par.pointee.extradata, par.pointee.extradata_size > 0, raw[0] == 1 else { return byProfile }
        let record = Data(bytes: raw, count: Int(par.pointee.extradata_size))

        lock.lock()
        if let known = cache[record] {
            lock.unlock()
            return known
        }
        lock.unlock()
        let answer = opensSession(hvcC: record, width: par.pointee.width, height: par.pointee.height)
        lock.lock()
        cache[record] = answer
        lock.unlock()
        NSLog("[DeviceDecode] hevc profile %d %dx%d: %@", par.pointee.profile, par.pointee.width, par.pointee.height, answer ? "decodes" : "no decoder")
        return answer
    }

    /// Asked once each: the answer cannot change while the process lives.
    static let hevc: Bool = opensSession(hvcC: Data(cannedMain), width: 1920, height: 1080)
    static let hevcMain10: Bool = opensSession(hvcC: Data(cannedMain10), width: 1920, height: 1080)
    static let av1Hardware: Bool = VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1)

    /// The JS-side copy of the same answers (services/localRemux.ts videoDecodeSupport).
    static func summary() -> [String: Any] {
        ["hevc": hevc, "hevcMain10": hevcMain10, "av1": av1Hardware]
    }

    private static let lock = NSLock()
    private static var cache: [Data: Bool] = [:]

    private static func opensSession(hvcC: Data, width: Int32, height: Int32) -> Bool {
        let atoms = [kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms as String: ["hvcC": hvcC]]
        var format: CMVideoFormatDescription?
        let made = CMVideoFormatDescriptionCreate(allocator: kCFAllocatorDefault, codecType: kCMVideoCodecType_HEVC,
                                                  width: width, height: height, extensions: atoms as CFDictionary,
                                                  formatDescriptionOut: &format)
        guard made == noErr, let format else { return false }
        var session: VTDecompressionSession?
        let status = VTDecompressionSessionCreate(allocator: kCFAllocatorDefault, formatDescription: format,
                                                  decoderSpecification: nil, imageBufferAttributes: nil,
                                                  outputCallback: nil, decompressionSessionOut: &session)
        if let session { VTDecompressionSessionInvalidate(session) }
        return status == noErr
    }

    // hvcC of a 64x64 x265 Main encode: VPS, SPS, PPS only.
    private static let cannedMain: [UInt8] = [
        0x01, 0x01, 0x60, 0x00, 0x00, 0x00, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1e, 0xf0, 0x00, 0xfc,
        0xfd, 0xf8, 0xf8, 0x00, 0x00, 0x0f, 0x03, 0xa0, 0x00, 0x01, 0x00, 0x18, 0x40, 0x01, 0x0c, 0x01,
        0xff, 0xff, 0x01, 0x60, 0x00, 0x00, 0x03, 0x00, 0x90, 0x00, 0x00, 0x03, 0x00, 0x00, 0x03, 0x00,
        0x1e, 0x95, 0x98, 0x09, 0xa1, 0x00, 0x01, 0x00, 0x28, 0x42, 0x01, 0x01, 0x01, 0x60, 0x00, 0x00,
        0x03, 0x00, 0x90, 0x00, 0x00, 0x03, 0x00, 0x00, 0x03, 0x00, 0x1e, 0xa0, 0x20, 0x81, 0x05, 0x96,
        0x56, 0x69, 0x24, 0xca, 0xf0, 0x16, 0x80, 0x80, 0x00, 0x00, 0x03, 0x00, 0x80, 0x00, 0x00, 0x0c,
        0x04, 0xa2, 0x00, 0x01, 0x00, 0x07, 0x44, 0x01, 0xc1, 0x72, 0xb4, 0x22, 0x40,
    ]

    // hvcC of the same encode at Main 10.
    private static let cannedMain10: [UInt8] = [
        0x01, 0x02, 0x20, 0x00, 0x00, 0x00, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1e, 0xf0, 0x00, 0xfc,
        0xfd, 0xfa, 0xfa, 0x00, 0x00, 0x0f, 0x03, 0xa0, 0x00, 0x01, 0x00, 0x18, 0x40, 0x01, 0x0c, 0x01,
        0xff, 0xff, 0x02, 0x20, 0x00, 0x00, 0x03, 0x00, 0x90, 0x00, 0x00, 0x03, 0x00, 0x00, 0x03, 0x00,
        0x1e, 0x95, 0x98, 0x09, 0xa1, 0x00, 0x01, 0x00, 0x2a, 0x42, 0x01, 0x01, 0x02, 0x20, 0x00, 0x00,
        0x03, 0x00, 0x90, 0x00, 0x00, 0x03, 0x00, 0x00, 0x03, 0x00, 0x1e, 0xa0, 0x20, 0x81, 0x04, 0xd9,
        0x65, 0x66, 0x92, 0x4c, 0xaf, 0x01, 0x68, 0x08, 0x00, 0x00, 0x03, 0x00, 0x08, 0x00, 0x00, 0x03,
        0x00, 0xc0, 0x40, 0xa2, 0x00, 0x01, 0x00, 0x07, 0x44, 0x01, 0xc1, 0x72, 0xb4, 0x22, 0x40,
    ]
}
