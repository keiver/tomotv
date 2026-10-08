//
//  InitSegmentSdr.swift
//  TomoTV
//
//  An init segment whose video sample entry carries PQ or HLG colour under a variant the master
//  declares SDR is refused by AVFoundation (-12927); the same bytes tagged BT.709 play. Only the
//  moov is rewritten, since the media segments carry no colour boxes.
//

import Foundation

enum InitSegmentSdr {
    private static let containers: Set<String> = ["moov", "trak", "mdia", "minf", "stbl"]
    private static let sampleEntries: Set<String> = ["avc1", "avc3", "hvc1", "hev1"]
    private static let dropped: Set<String> = ["mdcv", "clli"]
    private static let bt709: [UInt8] = [0, 1, 0, 1, 0, 1]

    /// The init with every video entry's colr set to BT.709 and its mdcv/clli dropped; nil when it carried none.
    static func normalise(_ data: Data) -> Data? {
        var changed = false
        let out = rewriteBoxes(Data(data), changed: &changed)
        return changed ? out : nil
    }

    /// A sequence of boxes, each rewritten in turn. A largesize or malformed box ends the rewrite with the rest untouched.
    private static func rewriteBoxes(_ data: Data, changed: inout Bool) -> Data {
        var out = Data()
        var offset = 0
        while offset + 8 <= data.count {
            let declared = Int(readUInt32(data, offset))
            let size = declared == 0 ? data.count - offset : declared
            guard declared != 1, size >= 8, offset + size <= data.count else {
                out.append(data.subdata(in: offset ..< data.count))
                return out
            }
            let type = String(decoding: data.subdata(in: offset + 4 ..< offset + 8), as: UTF8.self)
            out.append(rewriteBox(type: type, data.subdata(in: offset ..< offset + size), changed: &changed))
            offset += size
        }
        return out
    }

    private static func rewriteBox(type: String, _ box: Data, changed: inout Bool) -> Data {
        if containers.contains(type) {
            return wrap(type, rewriteBoxes(box.subdata(in: 8 ..< box.count), changed: &changed))
        }
        if type == "stsd" {
            // FullBox header and entry_count precede the sample entries.
            guard box.count >= 16 else { return box }
            return wrap(type, box.subdata(in: 8 ..< 16) + rewriteBoxes(box.subdata(in: 16 ..< box.count), changed: &changed))
        }
        if sampleEntries.contains(type) {
            // VisualSampleEntry: 78 bytes of fixed fields, then the child boxes.
            guard box.count >= 86 else { return box }
            var children = Data()
            var offset = 86
            while offset + 8 <= box.count {
                let size = Int(readUInt32(box, offset))
                guard size >= 8, offset + size <= box.count else { break }
                let childType = String(decoding: box.subdata(in: offset + 4 ..< offset + 8), as: UTF8.self)
                var child = box.subdata(in: offset ..< offset + size)
                if dropped.contains(childType) {
                    changed = true
                } else {
                    if childType == "colr", retagColr(&child) { changed = true }
                    children.append(child)
                }
                offset += size
            }
            return wrap(type, box.subdata(in: 8 ..< 86) + children)
        }
        return box
    }

    /// nclx/nclc: colour_type, then primaries, transfer and matrix, two bytes each. True when a tag changed.
    private static func retagColr(_ colr: inout Data) -> Bool {
        guard colr.count >= 18 else { return false }
        let kind = String(decoding: colr.subdata(in: 8 ..< 12), as: UTF8.self)
        guard kind == "nclx" || kind == "nclc", [UInt8](colr.subdata(in: 12 ..< 18)) != bt709 else { return false }
        colr.replaceSubrange(12 ..< 18, with: bt709)
        return true
    }

    private static func wrap(_ type: String, _ payload: Data) -> Data {
        let size = UInt32(payload.count + 8)
        var out = Data([UInt8(size >> 24), UInt8((size >> 16) & 0xff), UInt8((size >> 8) & 0xff), UInt8(size & 0xff)])
        out.append(Data(type.utf8))
        out.append(payload)
        return out
    }

    private static func readUInt32(_ data: Data, _ offset: Int) -> UInt32 {
        let start = data.startIndex + offset
        return UInt32(data[start]) << 24 | UInt32(data[start + 1]) << 16 | UInt32(data[start + 2]) << 8 | UInt32(data[start + 3])
    }
}
