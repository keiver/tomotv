//
//  JellyfinChannelId.swift
//  TomoTV
//
//  The item id Jellyfin gives a channel from an M3U tuner, computed from the tuner and stream
//  URLs alone (M3uParser.cs:104, M3UTunerHost.cs:67, LiveTvDtoService.cs:403, LibraryManager.cs:797).
//

import CryptoKit
import Foundation

enum JellyfinChannelId {
    /// Lowercase hex, no dashes: the `Id` Jellyfin reports for the channel.
    static func forM3u(tunerUrl: String, streamUrl: String) -> String {
        forM3u(tunerHash: md5Guid(tunerUrl), streamUrl: streamUrl)
    }

    /// The tuner's hash is constant across a playlist; callers mapping thousands of entries hoist it.
    static func forM3u(tunerHash: String, streamUrl: String) -> String {
        let external = "m3u_" + tunerHash + md5Guid(streamUrl)
        return md5Guid("MediaBrowser.Controller.LiveTv.LiveTvChannel" + ("Emby" + external + "4").lowercased())
    }

    /// .NET's `string.GetMD5()`: MD5 over UTF-16LE, formatted as `Guid.ToString("N")`.
    static func md5Guid(_ text: String) -> String {
        var bytes = [UInt8]()
        bytes.reserveCapacity(text.utf16.count * 2)
        for unit in text.utf16 {
            bytes.append(UInt8(unit & 0xFF))
            bytes.append(UInt8(unit >> 8))
        }
        let digest = Array(Insecure.MD5.hash(data: bytes))
        // A Guid stores its first three fields little-endian.
        let ordered = digest[0 ..< 4].reversed() + digest[4 ..< 6].reversed() + digest[6 ..< 8].reversed() + digest[8 ..< 16]
        return ordered.map { String(format: "%02x", $0) }.joined()
    }
}
