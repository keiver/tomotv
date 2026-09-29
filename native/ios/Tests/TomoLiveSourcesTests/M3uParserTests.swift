import XCTest

@testable import TomoLiveSources

final class M3uParserTests: XCTestCase {
    private func parse(_ text: String, chunks: [Int]? = nil) -> (header: M3uHeader, entries: [M3uEntry]) {
        parse(Array(text.utf8), chunks: chunks)
    }

    private func parse(_ bytes: [UInt8], chunks: [Int]? = nil) -> (header: M3uHeader, entries: [M3uEntry]) {
        let parser = M3uParser()
        var header = M3uHeader()
        var entries: [M3uEntry] = []
        parser.onHeader = { header = $0 }
        parser.onEntry = { entries.append($0) }
        Fixture.split(bytes, chunks ?? [max(bytes.count, 1)]) { parser.push($0) }
        parser.finish()
        return (header, entries)
    }

    private let playlist = """
    #EXTM3U x-tvg-url="http://g/a.xml.gz,http://g/b.xml" tvg-shift="-1" catchup="default" catchup-days="3"\r
    #EXTINF:-1 tvg-id="a.us" tvg-name="A One" tvg-logo="http://i/a.png" tvg-chno="12" group-title="News;Talk" http-user-agent="Mozilla/5.0 (X11; Linux, x86_64)",A One HD\r
    #EXTVLCOPT:http-referrer=http://r/\r
    http://s/a.m3u8\r
    #EXTINF:0 tvg-ID="B" ch-number="7" radio="TRUE" catchup-source="?utc={utc}" tvg-shift=2,Radio B\r
    http://s/b|User-Agent=Agent%2F1&Referer=http%3A%2F%2Fx%2F\r
    #EXTGRP:Kids;Movies\r
    #EXTINF:-1 tvg-id="c",C\r
    http://s/c\r
    #EXTINF:-1,D\r
    #KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\r
    #KODIPROP:inputstream.adaptive.license_key=http://l/\r
    http://s/d.mpd\r
    #EXTGRP:\r
    #EXTINF:-1,E\r
    http://s/e\r
    http://s/orphan\r
    """

    func testReadsHeaderAndEveryEntryField() {
        let (header, entries) = parse(playlist)
        XCTAssertEqual(header.tvgUrls, ["http://g/a.xml.gz", "http://g/b.xml"])
        XCTAssertEqual(header.tvgShift, -1)
        XCTAssertEqual(header.catchup, M3uCatchup(type: "default", source: nil, days: 3))
        XCTAssertEqual(entries.count, 6)

        let a = entries[0]
        XCTAssertEqual(a.name, "A One HD")
        XCTAssertEqual(a.url, "http://s/a.m3u8")
        XCTAssertEqual(a.line, "http://s/a.m3u8")
        XCTAssertTrue(a.hasExtInf)
        XCTAssertEqual(a.tvgId, "a.us")
        XCTAssertEqual(a.tvgName, "A One")
        XCTAssertEqual(a.tvgLogo, "http://i/a.png")
        XCTAssertEqual(a.tvgChno, "12")
        XCTAssertEqual(a.groups, ["News", "Talk"])
        XCTAssertEqual(a.headers, ["user-agent": "Mozilla/5.0 (X11; Linux, x86_64)", "referer": "http://r/"])
        XCTAssertFalse(a.radio)
        XCTAssertNil(a.catchup)
        XCTAssertFalse(a.drm)

        let b = entries[1]
        XCTAssertEqual(b.name, "Radio B")
        XCTAssertEqual(b.url, "http://s/b")
        XCTAssertEqual(b.line, "http://s/b|User-Agent=Agent%2F1&Referer=http%3A%2F%2Fx%2F")
        XCTAssertEqual(b.tvgId, "B")
        XCTAssertEqual(b.tvgChno, "7")
        XCTAssertTrue(b.radio)
        XCTAssertEqual(b.tvgShift, 2)
        XCTAssertEqual(b.catchup, M3uCatchup(type: nil, source: "?utc={utc}", days: nil))
        XCTAssertEqual(b.headers, ["user-agent": "Agent/1", "referer": "http://x/"])
        XCTAssertEqual(b.groups, [])

        XCTAssertEqual(entries[2].groups, ["Kids", "Movies"])
        XCTAssertEqual(entries[3].groups, ["Kids", "Movies"])
        XCTAssertTrue(entries[3].drm)
        XCTAssertEqual(entries[3].kodiProps["inputstream.adaptive.license_type"], "com.widevine.alpha")
        XCTAssertEqual(entries[4].groups, [])
        XCTAssertEqual(entries[4].kodiProps, [:])

        let orphan = entries[5]
        XCTAssertFalse(orphan.hasExtInf)
        XCTAssertEqual(orphan.name, "http://s/orphan")
        XCTAssertEqual(orphan.attrs, [:])
    }

    func testAnyChunkingGivesTheSamePlaylist() {
        let bytes = Array(playlist.utf8)
        let whole = parse(bytes)
        var random = SplitMix64(state: 11)
        var cases: [[Int]] = [[1], [2], [3, 7, 1], [64]]
        for _ in 0 ..< 30 { cases.append((0 ..< 5).map { _ in Int.random(in: 1 ... 120, using: &random) }) }
        for chunks in cases {
            let split = parse(bytes, chunks: chunks)
            XCTAssertEqual(split.header, whole.header, "chunks \(chunks)")
            XCTAssertEqual(split.entries, whole.entries, "chunks \(chunks)")
        }
    }

    func testLineEndingsBomAndCaseInsensitiveTags() {
        let text = "\u{FEFF}#extm3u\n#extinf:-1 GROUP-TITLE=\"G\",Lower\nhttp://s/l\n#EXTINF:-1,NoNewlineAtEnd\rhttp://s/n"
        let (_, entries) = parse(text.replacingOccurrences(of: "\rhttp", with: "\r\nhttp"))
        XCTAssertEqual(entries.map(\.name), ["Lower", "NoNewlineAtEnd"])
        XCTAssertEqual(entries[0].groups, ["G"])
    }

    func testTheNameIsTheTextAfterTheFirstCommaOutsideQuotes() {
        let (_, entries) = parse("#EXTINF:-1 tvg-name=\"Comma, Inc\" bare=1 flag,Real, Name\nhttp://s/x\n")
        XCTAssertEqual(entries[0].name, "Real, Name")
        XCTAssertEqual(entries[0].attrs["tvg-name"], "Comma, Inc")
        XCTAssertEqual(entries[0].attrs["bare"], "1")
        XCTAssertEqual(entries[0].attrs["flag"], "")
    }

    func testAMissingNameFallsBackToTvgNameThenTheUrl() {
        let (_, entries) = parse("#EXTINF:-1 tvg-name=\"Named\"\nhttp://s/1\n#EXTINF:-1\nhttp://s/2\n")
        XCTAssertEqual(entries.map(\.name), ["Named", "http://s/2"])
    }

    func testAnUnterminatedQuoteRunsToTheEndOfTheLine() {
        let (_, entries) = parse("#EXTINF:-1 tvg-id=\"open,Name\nhttp://s/x\n")
        XCTAssertEqual(entries[0].tvgId, "open,Name")
        XCTAssertEqual(entries[0].name, "http://s/x")
    }

    func testInvalidUtf8IsReplacedNotFatal() {
        let bytes = Array("#EXTINF:-1,Caf".utf8) + [0xE9, 0xFF] + Array("\nhttp://s/x\n".utf8)
        let (_, entries) = parse(bytes)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].name, "Caf\u{FFFD}\u{FFFD}")
    }

    func testPipeHeadersKeepABarePercent() {
        let (_, entries) = parse("#EXTINF:-1,X\nhttp://s/x|user-agent=100%25sure&!X-Odd=a%zz\n")
        XCTAssertEqual(entries[0].headers, ["user-agent": "100%sure", "x-odd": "a%zz"])
    }

    func testCatchupForms() {
        let (_, entries) = parse("#EXTINF:-1 timeshift=\"5\",A\nhttp://s/a\n#EXTINF:-1 catchup-type=\"append\" tvg-rec=\"0\",B\nhttp://s/b\n#EXTINF:-1 catchup-days=\"x\",C\nhttp://s/c\n")
        XCTAssertEqual(entries[0].catchup, M3uCatchup(type: "shift", source: nil, days: 5))
        XCTAssertEqual(entries[1].catchup, M3uCatchup(type: "append", source: nil, days: nil))
        XCTAssertNil(entries[2].catchup)
    }

    func testAnOutOfRangeCatchupDaysIsIgnored() {
        let (_, entries) = parse("#EXTINF:-1 catchup-days=\"1e300\",A\nhttp://s/a\n")
        XCTAssertNil(entries[0].catchup)
    }

    func testEmptyAndHeaderlessInput() {
        XCTAssertEqual(parse("").entries, [])
        let (header, entries) = parse("http://s/only\n")
        XCTAssertEqual(header, M3uHeader())
        XCTAssertEqual(entries.count, 1)
        XCTAssertFalse(entries[0].hasExtInf)
    }

    func testAMegabyteLineParses() {
        let long = String(repeating: "x", count: 1_048_576)
        let (_, entries) = parse("#EXTINF:-1,\(long)\nhttp://s/x\n", chunks: [4096])
        XCTAssertEqual(entries[0].name.count, long.count)
    }
}
