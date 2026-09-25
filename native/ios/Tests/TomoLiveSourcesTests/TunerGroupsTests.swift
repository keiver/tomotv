import XCTest

@testable import TomoLiveSources

final class TunerGroupsTests: XCTestCase {
    private let tuner = "https://iptv-org.github.io/iptv/index.m3u"

    private func entry(_ line: String, groups: [String], hasExtInf: Bool = true) -> M3uEntry {
        M3uEntry(name: "n", url: line, line: line, hasExtInf: hasExtInf, groups: groups)
    }

    func testMapsGroupsToTheServersIdsInPlaylistOrder() {
        let entries = [
            entry("https://jmp2.uk/plu-62ba60f059624e000781c436.m3u8", groups: ["Kids"]),
            entry("http://37.238.136.61/hls/stream.m3u8", groups: ["News", "Kids"]),
            entry("https://w2.manasat.com/cirkev-online/smil:cirkev-online.smil/playlist.m3u8", groups: []),
            entry("https://live.artidijitalmedya.com/artidijital_astv/astv/playlist.m3u8", groups: ["News"]),
        ]
        XCTAssertEqual(TunerGroups.groups(entries: entries, tunerUrl: tuner), [
            TunerGroup(name: "Kids", channelIds: ["29760fcf9675901f16991386edf6a0e3", "fdb32ffa9a959ca70da9c789042bfaa0"]),
            TunerGroup(name: "News", channelIds: ["fdb32ffa9a959ca70da9c789042bfaa0", "397e5eef20d1938d04a5dbdf1a5c4281"]),
        ])
    }

    /// Jellyfin skips a URL with no #EXTINF and any scheme outside http, https, rtsp, rtp and udp.
    func testFollowsJellyfinsChannelRules() {
        XCTAssertTrue(TunerGroups.isJellyfinChannel(entry("HTTP://s/a", groups: [])))
        XCTAssertTrue(TunerGroups.isJellyfinChannel(entry("rtsp://s/a", groups: [])))
        XCTAssertTrue(TunerGroups.isJellyfinChannel(entry("udp://239.0.0.1:1234", groups: [])))
        XCTAssertTrue(TunerGroups.isJellyfinChannel(entry("http://s/a|User-Agent=x", groups: [])))
        XCTAssertFalse(TunerGroups.isJellyfinChannel(entry("rtmp://s/a", groups: [])))
        XCTAssertFalse(TunerGroups.isJellyfinChannel(entry("srt://s:1", groups: [])))
        XCTAssertFalse(TunerGroups.isJellyfinChannel(entry("mmsh://s/a", groups: [])))
        XCTAssertFalse(TunerGroups.isJellyfinChannel(entry("/local/file.ts", groups: [])))
        XCTAssertFalse(TunerGroups.isJellyfinChannel(entry("http://s/a", groups: [], hasExtInf: false)))
        let skipped = [entry("rtmp://s/a", groups: ["G"]), entry("http://s/b", groups: ["G"], hasExtInf: false)]
        XCTAssertEqual(TunerGroups.groups(entries: skipped, tunerUrl: tuner), [])
    }

    func testHashesTheWholeLineIncludingPipeHeaders() {
        let plain = TunerGroups.groups(entries: [entry("http://s/a", groups: ["G"])], tunerUrl: tuner)
        let piped = TunerGroups.groups(entries: [entry("http://s/a|User-Agent=x", groups: ["G"])], tunerUrl: tuner)
        XCTAssertNotEqual(plain, piped)
    }
}
