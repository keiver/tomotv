import Foundation

enum VideoCodecDeclaration {
    static func fromInit(_ data: Data) -> String? {
        let path = ["moov", "trak", "mdia", "minf", "stbl", "stsd"]
        var parents = [Data(data)]
        for type in path {
            parents = parents.flatMap { boxes($0).filter { $0.type == type }.map(\.payload) }
        }
        for parent in parents where parent.count >= 8 {
            for entry in boxes(parent.subdata(in: 8..<parent.count)) where entry.payload.count >= 78 {
                let children = boxes(entry.payload.subdata(in: 78..<entry.payload.count))
                for child in children {
                    if let codec = fromConfiguration(sampleEntry: entry.type, box: child.type, data: child.payload) { return codec }
                }
            }
        }
        return nil
    }

    static func fromConfiguration(sampleEntry: String, box: String, data: Data) -> String? {
        let bytes = [UInt8](data)
        switch (sampleEntry, box) {
        case ("avc1", "avcC"), ("avc3", "avcC"):
            guard bytes.count >= 7, bytes[0] == 1 else { return nil }
            return sampleEntry + "." + bytes[1...3].map { String(format: "%02X", $0) }.joined()
        case ("hvc1", "hvcC"), ("hev1", "hvcC"):
            guard bytes.count >= 23, bytes[0] == 1 else { return nil }
            let space = ["", "A", "B", "C"][Int(bytes[1] >> 6)]
            let profile = bytes[1] & 31
            let tier = bytes[1] & 32 == 0 ? "L" : "H"
            let compatibility = bytes[2...5].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
            var reversed: UInt32 = 0
            for bit in 0..<32 { reversed |= ((compatibility >> bit) & 1) << (31 - bit) }
            var constraints = Array(bytes[6...11])
            while constraints.last == 0 { constraints.removeLast() }
            let suffix = constraints.map { "." + String($0, radix: 16, uppercase: true) }.joined()
            return "\(sampleEntry).\(space)\(profile).\(String(reversed, radix: 16, uppercase: true)).\(tier)\(bytes[12])\(suffix)"
        case ("av01", "av1C"):
            guard bytes.count >= 4, bytes[0] == 0x81 else { return nil }
            let profile = bytes[1] >> 5
            let level = bytes[1] & 31
            let tier = bytes[2] & 128 == 0 ? "M" : "H"
            let highBitDepth = bytes[2] & 64 != 0
            let depth = highBitDepth ? (profile == 2 && bytes[2] & 32 != 0 ? 12 : 10) : 8
            return String(format: "av01.%d.%02d%@.%02d", profile, level, tier, depth)
        default:
            return nil
        }
    }

    private static func boxes(_ data: Data) -> [(type: String, payload: Data)] {
        var result: [(type: String, payload: Data)] = []
        var offset = 0
        while data.count - offset >= 8 {
            let declared = data[offset..<offset + 4].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
            var size = declared == 0 ? UInt64(data.count - offset) : declared
            var header = 8
            if declared == 1 {
                guard data.count - offset >= 16 else { return [] }
                size = data[offset + 8..<offset + 16].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
                header = 16
            }
            guard size >= header, size <= data.count - offset else { return [] }
            let end = offset + Int(size)
            let type = String(decoding: data[offset + 4..<offset + 8], as: UTF8.self)
            result.append((type, data.subdata(in: offset + header..<end)))
            offset = end
        }
        return offset == data.count ? result : []
    }
}
