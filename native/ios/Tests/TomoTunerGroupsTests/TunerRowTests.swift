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
        entry.tvgChno = "42"
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

    func testRowRejectsWhatJellyfinWouldNotMakeAChannel() {
        let orphan = M3uEntry(name: "n", url: "http://s/orphan", line: "http://s/orphan", hasExtInf: false)
        let scheme = M3uEntry(name: "n", url: "rtmp://s/x", line: "rtmp://s/x", hasExtInf: true)
        XCTAssertNil(TunerGroups.row(entry: orphan, tunerHash: tunerHash))
        XCTAssertNil(TunerGroups.row(entry: scheme, tunerHash: tunerHash))
    }
}
