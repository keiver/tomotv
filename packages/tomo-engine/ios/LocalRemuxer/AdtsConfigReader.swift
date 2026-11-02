//
//  AdtsConfigReader.swift
//  TomoTV
//
//  The AudioSpecificConfig of an ADTS AAC stream, from Apple's own parser: ADTS carries no setup
//  header, and AVFoundation plays HE-AAC only under the explicit SBR and PS signaling Apple's
//  encoder writes, which the ADTS profile bits cannot express.
//

import AudioToolbox
import Foundation

struct AdtsConfig {
    let audioSpecificConfig: Data
    /// The richest layer the parser found ('aach' with SBR, 'aacp' with PS, else 'aac ').
    let richest: AudioFormatID
    /// The AAC-LC core under the SBR layer: half the output rate, mono under PS.
    let coreSampleRate: Int32
    let coreChannels: Int32

    var codecs: String {
        switch richest {
        case kAudioFormatMPEG4AAC_HE: return "mp4a.40.5"
        case kAudioFormatMPEG4AAC_HE_V2: return "mp4a.40.29"
        default: return "mp4a.40.2"
        }
    }
}

/// Feeds ADTS frames to AudioFileStream until it has read the stream's setup.
final class AdtsConfigReader {
    private var stream: AudioFileStreamID?
    private(set) var config: AdtsConfig?
    private(set) var framesFed = 0

    init?() {
        var opened: AudioFileStreamID?
        guard AudioFileStreamOpen(nil, { _, _, _, _ in }, { _, _, _, _, _ in }, kAudioFileAAC_ADTSType, &opened) == noErr,
              let opened else { return nil }
        stream = opened
    }

    deinit {
        if let stream { AudioFileStreamClose(stream) }
    }

    /// One ADTS frame; the config once the parser has it.
    @discardableResult
    func feed(_ bytes: UnsafePointer<UInt8>, count: Int) -> AdtsConfig? {
        guard config == nil, let stream, count > 0 else { return config }
        framesFed += 1
        guard AudioFileStreamParseBytes(stream, UInt32(count), bytes, []) == noErr else { return nil }
        var ready: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioFileStreamGetProperty(stream, kAudioFileStreamProperty_ReadyToProducePackets, &size, &ready) == noErr, ready == 1 else { return nil }
        config = Self.read(stream)
        return config
    }

    private static func read(_ stream: AudioFileStreamID) -> AdtsConfig? {
        var cookieSize: UInt32 = 0
        guard AudioFileStreamGetPropertyInfo(stream, kAudioFileStreamProperty_MagicCookieData, &cookieSize, nil) == noErr, cookieSize > 0 else { return nil }
        var cookie = [UInt8](repeating: 0, count: Int(cookieSize))
        guard AudioFileStreamGetProperty(stream, kAudioFileStreamProperty_MagicCookieData, &cookieSize, &cookie) == noErr,
              let audioSpecificConfig = decoderSpecificInfo(Data(cookie)) else { return nil }
        var listSize: UInt32 = 0
        guard AudioFileStreamGetPropertyInfo(stream, kAudioFileStreamProperty_FormatList, &listSize, nil) == noErr, listSize > 0 else { return nil }
        var list = [AudioFormatListItem](repeating: AudioFormatListItem(), count: Int(listSize) / MemoryLayout<AudioFormatListItem>.size)
        guard AudioFileStreamGetProperty(stream, kAudioFileStreamProperty_FormatList, &listSize, &list) == noErr,
              let richest = list.first, let core = list.last, core.mASBD.mSampleRate > 0, core.mASBD.mChannelsPerFrame > 0 else { return nil }
        return AdtsConfig(audioSpecificConfig: audioSpecificConfig, richest: richest.mASBD.mFormatID,
                          coreSampleRate: Int32(core.mASBD.mSampleRate), coreChannels: Int32(core.mASBD.mChannelsPerFrame))
    }

    /// The DecSpecificInfo of an MPEG-4 ES_Descriptor (ISO 14496-1: tag 0x03, DecoderConfigDescriptor 0x04, then 0x05).
    static func decoderSpecificInfo(_ esds: Data) -> Data? {
        let bytes = [UInt8](esds)
        var at = 0
        func open(_ tag: UInt8) -> Int? {
            guard at < bytes.count, bytes[at] == tag else { return nil }
            at += 1
            var length = 0
            for _ in 0..<4 {
                guard at < bytes.count else { return nil }
                let byte = bytes[at]
                at += 1
                length = (length << 7) | Int(byte & 0x7F)
                if byte & 0x80 == 0 { break }
            }
            return length
        }
        guard open(0x03) != nil, at + 3 <= bytes.count else { return nil }
        let flags = bytes[at + 2]
        at += 3
        if flags & 0x80 != 0 { at += 2 }
        if flags & 0x40 != 0 {
            guard at < bytes.count else { return nil }
            at += 1 + Int(bytes[at])
        }
        if flags & 0x20 != 0 { at += 2 }
        guard open(0x04) != nil else { return nil }
        at += 13
        guard let length = open(0x05), length > 0, at + length <= bytes.count else { return nil }
        return Data(bytes[at..<(at + length)])
    }
}
