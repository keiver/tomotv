import XCTest

@testable import TomoLiveSources

/// The same cases as utils/__tests__/guideMatch.test.ts: the parser must keep every channel the JS pairing picks.
final class GuideMatchTests: XCTestCase {
    private let channels = [
        GuideChannel(id: "CNN.us", displayNames: ["CNN"]),
        GuideChannel(id: "464745", displayNames: ["ABC News Live"]),
        GuideChannel(id: "bbc1", displayNames: ["BBC One HD"]),
        GuideChannel(id: "dup-a", displayNames: ["Local 7"]),
        GuideChannel(id: "dup-b", displayNames: ["Local 7"]),
    ]

    private func paired(_ requests: [GuideChannelRequest]) -> Set<String> {
        GuideChannelMatcher(requests: requests).pairedIds(channels)
    }

    func testPairsByTvgIdIgnoringCase() {
        XCTAssertEqual(paired([GuideChannelRequest(tvgId: "cnn.US", tvgName: nil, names: ["x"])]), ["CNN.us"])
    }

    func testPairsByTvgNameAsWrittenOrWithSpacesAsUnderscores() {
        XCTAssertEqual(paired([GuideChannelRequest(tvgId: "Unknown.us", tvgName: "abc news live", names: ["x"])]), ["464745"])
        XCTAssertEqual(paired([GuideChannelRequest(tvgId: nil, tvgName: "ABC_News_Live", names: ["x"])]), ["464745"])
    }

    func testPairsByNameAndTheFirstChannelInFileOrderWins() {
        XCTAssertEqual(paired([GuideChannelRequest(tvgId: nil, tvgName: nil, names: ["BBC One HD"])]), ["bbc1"])
        XCTAssertEqual(paired([GuideChannelRequest(tvgId: nil, tvgName: nil, names: ["Local 7"])]), ["dup-a"])
    }

    func testANameThatDiffersDoesNotPair() {
        let misses = [
            GuideChannelRequest(tvgId: nil, tvgName: nil, names: ["ABC News Live (720p)"]),
            GuideChannelRequest(tvgId: nil, tvgName: nil, names: ["BBC One"]),
            GuideChannelRequest(tvgId: "CNN.us@SD", tvgName: nil, names: ["CNN International"]),
        ]
        XCTAssertTrue(paired(misses).isEmpty)
    }

    func testKeepsWhatEveryPassAndEveryNamePairsWith() {
        // The JS pairing stops at the tvg-id; the parser keeps the other passes' picks too, so none is ever missing.
        XCTAssertEqual(paired([GuideChannelRequest(tvgId: "CNN.us", tvgName: "ABC News Live", names: ["nothing", "BBC One HD"])]), ["CNN.us", "464745", "bbc1"])
    }

    func testEmptyKeysPairWithNothing() {
        XCTAssertTrue(paired([GuideChannelRequest(tvgId: "", tvgName: " ", names: ["", "  "])]).isEmpty)
    }
}
