//
//  DeviceDecode.swift
//  TomoTV
//
//  What THIS device decodes in hardware, asked rather than assumed: only a hardware decode
//  is copied to AVPlayer, since a software decode there cannot be measured and one in the
//  engine can. The probes carry real parameter sets; a bare format fails (-8971) everywhere.
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
        let codec: Codec
        let byProfile: Bool
        switch par.pointee.codec_id {
        case AV_CODEC_ID_H264: (codec, byProfile) = (.h264, h264)
        case AV_CODEC_ID_HEVC: (codec, byProfile) = (.hevc, par.pointee.profile == Int32(AV_PROFILE_HEVC_MAIN_10) ? hevcMain10 : hevc)
        case AV_CODEC_ID_AV1: return av1Hardware
        default: return false
        }
        // Annex B extradata (raw .h264/.h265, MPEG-TS) carries no record; the profile class answers.
        guard let raw = par.pointee.extradata, par.pointee.extradata_size > 0, raw[0] == 1 else { return byProfile }
        let record = Data(bytes: raw, count: Int(par.pointee.extradata_size))
        let (width, height) = (par.pointee.width, par.pointee.height)
        let key = record + Data("\(width)x\(height)".utf8)

        lock.lock()
        if let known = cache[key] {
            lock.unlock()
            return known
        }
        lock.unlock()
        let status = sessionStatus(codec: codec, record: record, width: width, height: height)
        let answer = status == noErr
        lock.lock()
        cache[key] = answer
        lock.unlock()
        // A refusal is the probe's answer and leaves VideoToolbox's own VT-DS error line above it.
        NSLog("[DeviceDecode] %@ profile %d %dx%d: %@", codec.name, par.pointee.profile, width, height,
              answer ? "decodes" : "no hardware decoder, probe returned \(EngineLog.vtStatus(status))")
        return answer
    }

    /// Asked once each: the answer cannot change while the process lives. Each canned probe
    /// that finds no decoder leaves one VideoToolbox VT-DS error line in the log; it is the answer.
    static let h264: Bool = probe("h264 High", codec: .h264, record: Data(cannedHigh))
    static let hevc: Bool = probe("hevc Main", codec: .hevc, record: Data(cannedMain))
    static let hevcMain10: Bool = probe("hevc Main 10", codec: .hevc, record: Data(cannedMain10))

    private static func probe(_ name: String, codec: Codec, record: Data) -> Bool {
        let status = sessionStatus(codec: codec, record: record, width: 1920, height: 1080)
        if status != noErr { NSLog("[DeviceDecode] %@ 1920x1080: no hardware decoder, probe returned %@", name, EngineLog.vtStatus(status)) }
        return status == noErr
    }
    static let av1Hardware: Bool = VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1)

    /// Test seam: stands in for `hevcMain10` when set, so the 8-bit encoder path can run on a
    /// host that decodes Main 10. Nil in production.
    static var main10Override: Bool?
    static var main10ForEncoder: Bool { main10Override ?? hevcMain10 }

    /// The JS-side copy of the same answers (services/localRemux.ts videoDecodeSupport).
    static func summary() -> [String: Any] {
        ["hevc": hevc, "hevcMain10": hevcMain10, "av1": av1Hardware]
    }

    private static let lock = NSLock()
    private static var cache: [Data: Bool] = [:]

    enum Codec {
        case h264, hevc
        var name: String { self == .h264 ? "h264" : "hevc" }
        var type: CMVideoCodecType { self == .h264 ? kCMVideoCodecType_H264 : kCMVideoCodecType_HEVC }
        var atom: String { self == .h264 ? "avcC" : "hvcC" }
    }

    private static var hardwareOnly: CFDictionary? {
        if #available(iOS 17.0, tvOS 17.0, macOS 10.9, *) {
            return [kVTVideoDecoderSpecification_RequireHardwareAcceleratedVideoDecoder: true] as CFDictionary
        }
        return nil
    }

    /// noErr when this device opens a hardware decoder for the record at this size; the VideoToolbox status otherwise.
    private static func sessionStatus(codec: Codec, record: Data, width: Int32, height: Int32) -> OSStatus {
        let atoms = [kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms as String: [codec.atom: record]]
        var format: CMVideoFormatDescription?
        let made = CMVideoFormatDescriptionCreate(allocator: kCFAllocatorDefault, codecType: codec.type,
                                                  width: width, height: height, extensions: atoms as CFDictionary,
                                                  formatDescriptionOut: &format)
        guard made == noErr, let format else { return made == noErr ? kVTParameterErr : made }
        var session: VTDecompressionSession?
        let status = VTDecompressionSessionCreate(allocator: kCFAllocatorDefault, formatDescription: format,
                                                  decoderSpecification: hardwareOnly, imageBufferAttributes: nil,
                                                  outputCallback: nil, decompressionSessionOut: &session)
        if let session { VTDecompressionSessionInvalidate(session) }
        return status
    }

    // avcC of a 64x64 x264 High encode: SPS, PPS only.
    private static let cannedHigh: [UInt8] = [
        0x01, 0x64, 0x00, 0x0a, 0xff, 0xe1, 0x00, 0x18, 0x67, 0x64, 0x00, 0x0a, 0xac, 0xd9, 0x44, 0x26,
        0xc0, 0x44, 0x00, 0x00, 0x03, 0x00, 0x04, 0x00, 0x00, 0x03, 0x00, 0xc0, 0x3c, 0x48, 0x96, 0x58,
        0x01, 0x00, 0x06, 0x68, 0xeb, 0xe3, 0xcb, 0x22, 0xc0, 0xfd, 0xf8, 0xf8, 0x00,
    ]

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
