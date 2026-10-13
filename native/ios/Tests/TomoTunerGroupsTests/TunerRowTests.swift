import XCTest

@testable import TomoLiveSources
@testable import TomoTunerGroups

final class TunerRowTests: XCTestCase {
    private let tunerHash = JellyfinChannelId.md5Guid("https://iptv-org.github.io/iptv/index.m3u")

    func testRowCarriesEverythingATileAndTuneNeed() {
        var entry = M3uEntry(
            name: "00s Replay",
            url: "https://jmp2.uk/plu-62ba60f059624e000781c436.m3u8",
            line: "https://jmp2.uk/plu-62ba60f059624e000781c436.m3u8|User-Agent=okhttp",
            hasExtInf: true,
            tvgId: "00sReplay.us@SD",
            tvgName: "00s Replay"
        )
        entry.tvgLogo = "https://images.pluto.tv/channels/replay/logo.png"
        entry.attrs = ["tvg-chno": "42"]
        entry.groups = ["Music", "Retro"]
        entry.headers = ["user-agent": "okhttp"]
        let row = TunerGroups.row(entry: entry, tunerHash: tunerHash)
        XCTAssertEqual(
            row,
            TunerRow(
                id: JellyfinChannelId.forM3u(tunerHash: tunerHash, streamUrl: entry.line),
                name: "00s Replay",
                number: "42",
                logo: "https://images.pluto.tv/channels/replay/logo.png",
                url: "https://jmp2.uk/plu-62ba60f059624e000781c436.m3u8",
                headers: ["user-agent": "okhttp"],
                groups: ["Music", "Retro"],
                tvgId: "00sReplay.us@SD",
                tvgName: "00s Replay",
                radio: false,
                drm: false
            )
        )
    }

    /// Name and number as Jellyfin's M3uParser assigns them; the first three are the server's own answers for these entries.
    func testRowNamesAndNumbersTheChannelAsJellyfinDoes() {
        func named(_ name: String, url: String = "https://s.example/live/stream.m3u8", attrs: [String: String] = [:]) -> [String?] {
            var entry = M3uEntry(name: name, url: url, line: url, hasExtInf: true)
            entry.attrs = attrs
            let row = TunerGroups.row(entry: entry, tunerHash: tunerHash)
            return [row?.name, row?.number]
        }
        XCTAssertEqual(named("4 Fun Dance"), ["Fun Dance", "4"])
        XCTAssertEqual(named("3 Stones TV (240p) [Not 24/7]"), ["Stones TV (240p) [Not 24/7]", "3"])
        XCTAssertEqual(named("NAN TV"), ["TV", "NAN"])
        XCTAssertEqual(named("84. VOX Schweiz"), ["VOX Schweiz", "84"])
        XCTAssertEqual(named("84.0 - VOX Schweiz"), ["VOX Schweiz", "84.0"])
        XCTAssertEqual(named("1+1 Marafon"), ["1+1 Marafon", nil])
        // The attribute wins the number; the name still loses its numeric prefix.
        XCTAssertEqual(named("5 USA", attrs: ["tvg-chno": "12"]), ["USA", "12"])
        XCTAssertEqual(named("News", attrs: ["tvg-chno": "0", "tvg-id": "7"]), ["News", "7"])
        XCTAssertEqual(named("News", attrs: ["tvg-id": "news.us", "channel-id": "15"]), ["News", "15"])
        XCTAssertEqual(named("News", attrs: ["tvg-id": "news.us", "ch-number": "9"]), ["News", nil])
        XCTAssertEqual(named("CNN", url: "http://host.example/live/user/pass/12345.ts"), ["CNN", "12345"])
        XCTAssertEqual(named("CNN", url: "http://host.example/live/0.ts"), ["CNN", nil])
        XCTAssertEqual(named("News, Sports HD"), ["Sports HD", nil])
        // No title on the #EXTINF line: the parser's own fallback name is the URL.
        XCTAssertEqual(named("https://s.example/live/stream.m3u8", attrs: ["tvg-name": "Fallback"]), ["Fallback", nil])
    }

    func testRowRejectsWhatJellyfinWouldNotMakeAChannel() {
        let orphan = M3uEntry(name: "n", url: "http://s/orphan", line: "http://s/orphan", hasExtInf: false)
        let scheme = M3uEntry(name: "n", url: "rtmp://s/x", line: "rtmp://s/x", hasExtInf: true)
        XCTAssertNil(TunerGroups.row(entry: orphan, tunerHash: tunerHash))
        XCTAssertNil(TunerGroups.row(entry: scheme, tunerHash: tunerHash))
    }
}
