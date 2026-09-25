import XCTest

@testable import TomoLiveSources

final class TunerChannelsTests: XCTestCase {
    private let tuner = "https://iptv-org.github.io/iptv/index.m3u"

    private func entry(_ line: String, tvgId: String?, hasExtInf: Bool = true) -> M3uEntry {
        M3uEntry(name: "n", url: line, line: line, hasExtInf: hasExtInf, tvgId: tvgId)
    }

    func testEmitsIdAndTvgIdForJellyfinChannelsOnly() {
        let entries = [
            entry("https://jmp2.uk/plu-62ba60f059624e000781c436.m3u8", tvgId: "00sReplay.us@SD"),
            entry("http://s/no-tvg", tvgId: nil),
            entry("rtmp://s/skipped", tvgId: "Skipped.us"),
            entry("http://s/orphan", tvgId: "Orphan.us", hasExtInf: false),
        ]
        XCTAssertEqual(TunerGroups.channels(entries: entries, tunerUrl: tuner), [
            TunerChannel(id: "29760fcf9675901f16991386edf6a0e3", tvgId: "00sReplay.us@SD"),
        ])
    }
}
