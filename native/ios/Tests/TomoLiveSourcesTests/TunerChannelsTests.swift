import XCTest

@testable import TomoLiveSources

final class TunerChannelsTests: XCTestCase {
    private let tuner = "https://iptv-org.github.io/iptv/index.m3u"

    private func entry(_ line: String, tvgId: String?, tvgName: String? = nil, hasExtInf: Bool = true) -> M3uEntry {
        M3uEntry(name: "n", url: line, line: line, hasExtInf: hasExtInf, tvgId: tvgId, tvgName: tvgName)
    }

    func testEmitsIdTvgIdAndTvgNameForJellyfinChannelsOnly() {
        let entries = [
            entry("https://jmp2.uk/plu-62ba60f059624e000781c436.m3u8", tvgId: "00sReplay.us@SD", tvgName: "00s Replay"),
            entry("http://s/name-only", tvgId: nil, tvgName: "Local News"),
            entry("http://s/no-tvg", tvgId: nil),
            entry("rtmp://s/skipped", tvgId: "Skipped.us"),
            entry("http://s/orphan", tvgId: "Orphan.us", hasExtInf: false),
        ]
        let channels = TunerGroups.channels(entries: entries, tunerUrl: tuner)
        XCTAssertEqual(channels.first, TunerChannel(id: "29760fcf9675901f16991386edf6a0e3", tvgId: "00sReplay.us@SD", tvgName: "00s Replay"))
        XCTAssertEqual(channels.map(\.tvgName), ["00s Replay", "Local News"])
        XCTAssertEqual(channels.last?.tvgId, nil)
    }
}
