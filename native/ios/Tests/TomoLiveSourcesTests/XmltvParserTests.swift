import XCTest

@testable import TomoLiveSources

final class XmltvParserTests: XCTestCase {
    private let sample = """
    <?xml version="1.0" encoding="UTF-8"?><!DOCTYPE tv SYSTEM "xmltv.dtd"><tv>
    <channel id="a.us"><display-name>A</display-name><display-name>A HD</display-name><icon src="http://i/a.png"/></channel>
    <programme start="20260925010000 +0000" stop="20260925020000 +0000" channel="a.us"><title lang="en">News &amp; More</title><title lang="es">Noticias</title><sub-title>Part 1</sub-title><desc><![CDATA[Late <b>news</b>]]></desc><category>News</category><category>Talk</category><episode-num system="xmltv_ns">0.1.0/1</episode-num><episode-num system="onscreen">S01E02</episode-num><icon src="http://i/p.png"/><rating system="VCHIP"><value>TV-PG</value></rating><new/></programme>
    <programme start="20260925020000 +0000" stop="20260925030000 +0000" channel="a.us"><title>Bad&nbsp;Entity</title></programme>
    <programme start="20260925030000 +0000" stop="20260925040000 +0000" channel="a.us"><title>After</title><previously-shown/></programme>
    </tv>
    """

    // MARK: Fields

    func testReadsEveryFieldAndKeepsTheFirstTitle() {
        let (store, parser) = Fixture.parse(sample)
        XCTAssertEqual(store.channels, [GuideChannel(id: "a.us", displayNames: ["A", "A HD"], icon: "http://i/a.png")])
        let programmes = Fixture.programmes(store)
        XCTAssertEqual(programmes.count, 3)
        let first = programmes[0]
        XCTAssertEqual(first.title, "News & More")
        XCTAssertEqual(first.subTitle, "Part 1")
        XCTAssertEqual(first.desc, "Late <b>news</b>")
        XCTAssertEqual(first.categories, ["News", "Talk"])
        XCTAssertEqual(first.episodeNumbers, [GuideEpisodeNumber(system: "xmltv_ns", value: "0.1.0/1"), GuideEpisodeNumber(system: "onscreen", value: "S01E02")])
        XCTAssertEqual(first.icon, "http://i/p.png")
        XCTAssertEqual(first.rating, "TV-PG")
        XCTAssertTrue(first.isNew)
        XCTAssertFalse(first.previouslyShown)
        XCTAssertEqual(first.start, 1_790_298_000_000)
        XCTAssertEqual(first.stop, 1_790_301_600_000)
        XCTAssertTrue(programmes[2].previouslyShown)
        XCTAssertEqual(parser.programmes, 3)
        XCTAssertEqual(parser.channels, 1)
    }

    func testAnUndeclaredEntityStaysLiteral() {
        let (store, parser) = Fixture.parse(sample)
        XCTAssertEqual(Fixture.programmes(store)[1].title, "Bad&nbsp;Entity")
        XCTAssertEqual(parser.errors, 0)
    }

    func testBareAmpersandsAreKeptInTextAndAttributes() {
        let text = """
        <tv><channel id="a.us"><icon src="http://i/a.png?w=1&h=2&amp;x=3"/></channel>\
        <programme start="20260925010000 +0000" channel="a.us"><title>Tom & Jerry &amp; Co & &#38; &lt; A&B</title>\
        <desc><![CDATA[Raw & <b>bold</b> ]]&gt; & done]]> tail & end</desc><category>R&D</category></programme></tv>
        """
        let bytes = Array(text.utf8)
        for chunks in [[bytes.count], [1], [2], [3], [5], [7, 11, 13], [64]] {
            let (store, parser) = Fixture.parse(bytes, chunks: chunks)
            let programme = Fixture.programmes(store).first
            XCTAssertEqual(store.channels.first?.icon, "http://i/a.png?w=1&h=2&x=3", "chunks \(chunks)")
            XCTAssertEqual(programme?.title, "Tom & Jerry & Co & & < A&B", "chunks \(chunks)")
            XCTAssertEqual(programme?.desc, "Raw & <b>bold</b> ]]&gt; & done tail & end", "chunks \(chunks)")
            XCTAssertEqual(programme?.categories, ["R&D"], "chunks \(chunks)")
            XCTAssertEqual(parser.errors, 0, "chunks \(chunks)")
        }
    }

    func testAmpersandEscaperDecidesReferencesAtChunkEnds() {
        let cases: [(String, String)] = [
            ("a&", "a&amp;"), ("&;", "&amp;;"), ("&#;", "&amp;#;"), ("&#x;", "&amp;#x;"), ("&#12;", "&#12;"), ("&#x1F;", "&#x1F;"),
            ("&#xZ;", "&amp;#xZ;"), ("&amp;", "&amp;"), ("&AMP;", "&amp;AMP;"), ("&nbsp;", "&amp;nbsp;"), ("&#1234567890123;", "&amp;#1234567890123;"),
            ("<![CDATA[&]]>&", "<![CDATA[&]]>&amp;"), ("<![CDA", "<![CDA"), ("<![CDATA[a]]", "<![CDATA[a]]"), ("<!DOCTYPE x [<!ENTITY e \"&e;\">]>", "<!DOCTYPE x [<!ENTITY e \"&amp;e;\">]>"),
        ]
        for (input, expected) in cases {
            let bytes = Array(input.utf8)
            for chunks in [[bytes.count], [1], [2], [3]] {
                var escaper = AmpersandEscaper()
                var out: [UInt8] = []
                Fixture.split(bytes, chunks) { escaper.filter($0, flush: false) { out.append(contentsOf: $0) } }
                escaper.filter(UnsafeRawBufferPointer(start: nil, count: 0), flush: true) { out.append(contentsOf: $0) }
                XCTAssertEqual(String(decoding: out, as: UTF8.self), expected, "input \(input) chunks \(chunks)")
            }
        }
    }

    func testDecodesPredefinedAndNumericEntities() {
        let (store, _) = Fixture.parse(Fixture.programme("<title>&lt;a&gt; &quot;b&quot; &apos;c&apos; &#233; &#x2603;</title>"))
        XCTAssertEqual(Fixture.programmes(store).first?.title, "<a> \"b\" 'c' é ☃")
    }

    func testDecodesEntitiesInAttributes() {
        let text = """
        <tv><channel id="Fix.&amp;.Foxi"><icon src="http://i/a.png?w=1&amp;h=2&amp;#38;x=&lt;&#233;&gt;"/></channel>\
        <programme start="20260925010000 +0000" channel="Fix.&amp;.Foxi"><episode-num system="a&amp;b">1</episode-num></programme></tv>
        """
        let (store, _) = Fixture.parse(text)
        XCTAssertEqual(store.channels.first?.id, "Fix.&.Foxi")
        XCTAssertEqual(store.channels.first?.icon, "http://i/a.png?w=1&h=2&#38;x=<é>")
        let programme = Fixture.programmes(store, "Fix.&.Foxi").first
        XCTAssertEqual(programme?.episodeNumbers.first?.system, "a&b")
    }

    func testTextOfNestedMarkupBelongsToTheField() {
        let (store, _) = Fixture.parse(Fixture.programme("<desc>one <b>two</b> three</desc><title>T</title>"))
        let programme = Fixture.programmes(store).first
        XCTAssertEqual(programme?.desc, "one two three")
        XCTAssertEqual(programme?.title, "T")
    }

    func testUnknownElementsCarryNothingIntoFields() {
        let (store, _) = Fixture.parse(Fixture.programme("<credits><director>X</director><actor>Y</actor></credits><video><quality>HDTV</quality></video><title>T</title><star-rating><value>7/10</value></star-rating>"))
        let programme = Fixture.programmes(store).first
        XCTAssertEqual(programme?.title, "T")
        XCTAssertNil(programme?.rating)
        XCTAssertNil(programme?.desc)
    }

    func testTrimsWhitespaceAndDropsEmptyValues() {
        let (store, _) = Fixture.parse(Fixture.programme("<title>\n   Spaced   \n</title><category>  </category><sub-title></sub-title>"))
        let programme = Fixture.programmes(store).first
        XCTAssertEqual(programme?.title, "Spaced")
        XCTAssertEqual(programme?.categories, [])
        XCTAssertNil(programme?.subTitle)
    }

    func testCapsAFieldAtAMegabyteAndKeepsParsing() {
        let long = String(repeating: "x", count: 3 * XmltvParser.fieldCap)
        let (store, parser) = Fixture.parse(Array(Fixture.programme("<desc>\(long)</desc><desc><![CDATA[\(long)]]></desc><title>After</title>").utf8), chunks: [65536])
        let programme = Fixture.programmes(store).first
        XCTAssertEqual(programme?.desc?.count, XmltvParser.fieldCap)
        XCTAssertEqual(programme?.title, "After")
        XCTAssertEqual(parser.errors, 0)
    }

    // MARK: Programme attributes

    func testSkipsProgrammesWithoutChannelOrStart() {
        let text = """
        <tv><programme start="20260925010000 +0000"><title>No channel</title></programme>\
        <programme channel="a.us"><title>No start</title></programme>\
        <programme start="garbage" channel="a.us"><title>Bad start</title></programme>\
        <programme start="20260925010000 +0000" channel=""><title>Empty channel</title></programme>\
        <programme start="20260925010000 +0000" channel="a.us"><title>No stop</title></programme></tv>
        """
        let (store, parser) = Fixture.parse(text)
        XCTAssertEqual(Fixture.programmes(store).map(\.title), ["No stop"])
        XCTAssertNil(Fixture.programmes(store).first?.stop)
        XCTAssertEqual(parser.skipped, 4)
    }

    func testDateForms() {
        func date(_ text: String) -> Int64? { Array(text.utf8).withUnsafeBufferPointer { XmltvParser.parseDate($0) } }
        XCTAssertEqual(date("20260925010000 +0000"), 1_790_298_000_000)
        XCTAssertEqual(date("20260925010000 -0500"), 1_790_316_000_000)
        XCTAssertEqual(date("20260925010000 +05:30"), 1_790_278_200_000)
        XCTAssertEqual(date("20260925010000+0100"), 1_790_294_400_000)
        XCTAssertEqual(date("20260925010000 Z"), 1_790_298_000_000)
        XCTAssertEqual(date("20260925010000"), 1_790_298_000_000)
        XCTAssertEqual(date("202609250100"), 1_790_298_000_000)
        XCTAssertEqual(date("20260925"), 1_790_294_400_000)
        XCTAssertEqual(date("2026"), 1_767_225_600_000)
        XCTAssertEqual(date("20280229120000 +0000"), 1_835_438_400_000)
        XCTAssertEqual(date("19691231235959 +0000"), -1000)
        XCTAssertNil(date("20261399"))
        XCTAssertNil(date("20260025"))
        XCTAssertNil(date("20260932"))
        XCTAssertNil(date("20260925240000"))
        XCTAssertNil(date("20260925006000"))
        XCTAssertNil(date("20260925000061"))
        XCTAssertNil(date("garbage"))
        XCTAssertNil(date("2026092"))
        XCTAssertNil(date("20260925010000 +01"))
        XCTAssertNil(date(""))
    }

    // MARK: Window

    func testWindowKeepsOnlyOverlappingProgrammes() {
        // 02:10 to 02:50 overlaps only the 02:00 to 03:00 programme.
        let (store, parser) = Fixture.parse(Array(sample.utf8), window: GuideWindow(from: 1_790_302_200_000, to: 1_790_304_600_000))
        XCTAssertEqual(Fixture.programmes(store).map(\.start), [1_790_301_600_000])
        XCTAssertEqual(parser.skipped, 2)
    }

    func testWindowEdgesAreInclusive() {
        // [02:00, 03:00]: the programme ending at 02:00 and the one starting at 03:00 both touch it.
        let (store, parser) = Fixture.parse(Array(sample.utf8), window: GuideWindow(from: 1_790_301_600_000, to: 1_790_305_200_000))
        XCTAssertEqual(Fixture.programmes(store).count, 3)
        XCTAssertEqual(parser.skipped, 0)
    }

    func testASkippedProgrammesTextNeverLeaksIntoTheNext() {
        // 03:30 falls only inside the 03:00 to 04:00 programme.
        let (store, _) = Fixture.parse(Array(sample.utf8), window: GuideWindow(from: 1_790_307_000_000, to: 1_790_307_000_000))
        XCTAssertEqual(Fixture.programmes(store).map(\.title), ["After"])
    }

    // MARK: Input shapes

    func testAnyChunkingGivesTheSameGuide() {
        let bytes = Array(sample.utf8)
        let whole = Fixture.programmes(Fixture.parse(bytes).store)
        var random = SplitMix64(state: 7)
        var cases: [[Int]] = [[1], [2], [7, 13, 1], [4096]]
        for _ in 0 ..< 30 { cases.append((0 ..< 5).map { _ in Int.random(in: 1 ... 200, using: &random) }) }
        for chunks in cases {
            XCTAssertEqual(Fixture.programmes(Fixture.parse(bytes, chunks: chunks).store), whole, "chunks \(chunks)")
        }
    }

    func testReadsAUTF8ByteOrderMark() {
        let (store, _) = Fixture.parse([0xEF, 0xBB, 0xBF] + Array(Fixture.programme("<title>BOM</title>").utf8))
        XCTAssertEqual(Fixture.programmes(store).first?.title, "BOM")
    }

    /// A first chunk too short to sniff, ending on a `<` the escaper holds: the held byte stays behind the ones let through.
    func testAFirstChunkEndingOnAHeldTagReadsTheSame() {
        let bom: [UInt8] = [0xEF, 0xBB, 0xBF] + Array(Fixture.programme("<title>BOM</title>").utf8)
        let spaced = Array(#"   <tv><programme start="20260925010000 +0000" channel="a.us"><title>Space</title></programme></tv>"#.utf8)
        for (bytes, title) in [(bom, "BOM"), (spaced, "Space")] {
            for chunks in [[4], [1], [2], [4, 64]] {
                let (store, parser) = Fixture.parse(bytes, chunks: chunks)
                XCTAssertEqual(Fixture.programmes(store).first?.title, title, "\(title) chunks \(chunks)")
                XCTAssertEqual(parser.errors, 0, "\(title) chunks \(chunks)")
            }
        }
    }

    func testDecodesADeclaredLatin1Document() {
        var bytes = Array(#"<?xml version="1.0" encoding="ISO-8859-1"?><tv><programme start="20260925010000 +0000" channel="a.us"><title>Caf"#.utf8)
        bytes += [0xE9]
        bytes += Array("</title></programme></tv>".utf8)
        XCTAssertEqual(Fixture.programmes(Fixture.parse(bytes).store).first?.title, "Café")
    }

    func testDecodesAUTF16Document() {
        let text = Fixture.programme("<title>Sixteen ☃</title>").replacingOccurrences(of: "UTF-8", with: "UTF-16")
        let bytes: [UInt8] = [0xFF, 0xFE] + text.utf16.flatMap { [UInt8($0 & 0xFF), UInt8($0 >> 8)] }
        for chunks in [[bytes.count], [1], [2], [3], [4], [5], [64]] {
            XCTAssertEqual(Fixture.programmes(Fixture.parse(bytes, chunks: chunks).store).first?.title, "Sixteen ☃", "chunks \(chunks)")
        }
    }

    func testNeverReadsAnExternalEntity() throws {
        let secret = FileManager.default.temporaryDirectory.appendingPathComponent("xxe-\(UUID().uuidString).txt")
        try "LEAKED".write(to: secret, atomically: true, encoding: .utf8)
        addTeardownBlock { try? FileManager.default.removeItem(at: secret) }
        let text = """
        <?xml version="1.0"?><!DOCTYPE tv [<!ENTITY xxe SYSTEM "\(secret.absoluteString)">]>\
        <tv><programme start="20260925010000 +0000" channel="a.us"><title>x&xxe;y</title></programme></tv>
        """
        let programmes = Fixture.programmes(Fixture.parse(text).store)
        XCTAssertEqual(programmes.count, 1)
        XCTAssertEqual(programmes.first?.title, "x&xxe;y")
    }

    func testAnEntityExpansionBombEndsQuickly() {
        var entities = #"<!ENTITY a0 "lol">"#
        for level in 1 ... 12 { entities += "<!ENTITY a\(level) \"" + String(repeating: "&a\(level - 1);", count: 10) + "\">" }
        let text = "<?xml version=\"1.0\"?><!DOCTYPE tv [\(entities)]><tv><programme start=\"20260925010000 +0000\" channel=\"a.us\"><title>&a12;</title></programme></tv>"
        let started = Date()
        let (store, _) = Fixture.parse(text)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
        XCTAssertEqual(Fixture.programmes(store).map(\.title), ["&a12;"])
    }

    func testAProgrammeWithoutStopIsKeptByAWindowAfterItsStart() {
        let text = """
        <tv><programme start="20260925010000 +0000" channel="a.us"><title>Open</title></programme>\
        <programme start="20260925030000 +0000" channel="a.us"><title>Next</title></programme></tv>
        """
        // 01:10 to 01:20: the first programme is on air; the second, still open-ended at parse time, starts after the window.
        let (store, parser) = Fixture.parse(Array(text.utf8), window: GuideWindow(from: 1_790_298_600_000, to: 1_790_299_200_000))
        XCTAssertEqual(Fixture.programmes(store).map(\.title), ["Open"])
        XCTAssertEqual(parser.skipped, 1)
        // With both loaded, the first ends where the second starts: a window at 03:30 sees only the second.
        let (all, _) = Fixture.parse(text)
        XCTAssertEqual(all.programmes(channelIds: ["a.us"], window: GuideWindow(from: 1_790_307_000_000, to: 1_790_307_000_000)).map(\.title), ["Next"])
        XCTAssertEqual(all.programmes(channelIds: ["a.us"], window: GuideWindow(from: 1_790_298_600_000, to: 1_790_299_200_000)).map(\.title), ["Open"])
    }

    func testATruncatedDocumentKeepsWhatClosed() {
        let cut = String(sample.prefix(through: sample.range(of: "Bad&nbsp;")!.lowerBound))
        let (store, parser) = Fixture.parse(cut)
        XCTAssertEqual(Fixture.programmes(store).map(\.title), ["News & More"])
        XCTAssertGreaterThan(parser.errors, 0)
    }

    func testEmptyAndNonXMLInputProduceNothing() {
        XCTAssertEqual(Fixture.parse([UInt8]()).store.programmeCount, 0)
        let (store, parser) = Fixture.parse("this is not xml at all")
        XCTAssertEqual(store.programmeCount, 0)
        XCTAssertGreaterThan(parser.errors, 0)
    }

    // MARK: Real guide

    func testRealGuideMatchesTheReferenceCounts() throws {
        let data = try Fixture.realGuide()
        let started = Date()
        let stats = try GuideLoader.parse(data: data, window: nil, store: GuideStore())
        print("real guide: \(stats), \(Int(Date().timeIntervalSince(started) * 1000)) ms")
        XCTAssertEqual(stats.channels, 769)
        XCTAssertEqual(stats.programmes, 79138)
        XCTAssertEqual(stats.errors, 0)
        XCTAssertEqual(stats.load.inflatedBytes, 75_590_619)
    }

    func testRealGuideUnderRandomSplitsEqualsTheWholeParse() throws {
        let data = try Fixture.realGuide()
        let whole = GuideStore()
        _ = try GuideLoader.parse(data: data, window: nil, store: whole)
        let wholeChannels = whole.channels.map(\.id)
        let wholeProgrammes = whole.programmes(channelIds: wholeChannels, window: Fixture.everything)
        var random = SplitMix64(state: 2026)
        for trial in 0 ..< 3 {
            let chunks = (0 ..< 16).map { _ in Int.random(in: 1 ... 90_000, using: &random) }
            let store = GuideStore()
            let parser = XmltvParser()
            parser.onChannel = { store.add($0) }
            parser.onProgramme = { store.add($0) }
            let gunzip = Gunzip()
            try Fixture.split(Array(data), chunks) { try gunzip.push($0) { parser.push($0) } }
            try gunzip.finish { parser.push($0) }
            parser.finish()
            XCTAssertEqual(store.channels.map(\.id), wholeChannels, "trial \(trial)")
            XCTAssertEqual(store.programmes(channelIds: wholeChannels, window: Fixture.everything), wholeProgrammes, "trial \(trial) chunks \(chunks)")
        }
    }
}
