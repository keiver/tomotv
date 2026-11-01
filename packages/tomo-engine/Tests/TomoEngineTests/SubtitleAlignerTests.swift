import XCTest

@testable import TomoEngine

/// Lining a track's cues up with the speech in the audio: the detector, the shift search, and the
/// window read from a file through the session.
final class SubtitleAlignerTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    private static let rate = 16000
    private static let seconds = 180.0

    private static let fixtureDir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures/aligner", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private static func next(_ state: inout UInt32) -> Double {
        state = state &* 1_664_525 &+ 1_013_904_223
        return Double(state >> 8) / Double(1 << 24)
    }

    /// Speech-like bursts, 0.6 to 3 s long with 0.4 to 2.4 s between them, the same every run.
    private static let bursts: [(start: Double, end: Double)] = {
        var state: UInt32 = 7
        var spans: [(start: Double, end: Double)] = []
        var time = 0.0
        while time < seconds + 10 {
            let gap = 0.4 + next(&state) * 2
            let length = 0.6 + next(&state) * 2.4
            spans.append((time + gap, time + gap + length))
            time += gap + length
        }
        return spans
    }()

    /// Noise during the bursts, silence between them.
    private static func burstSamples(seconds: Double) -> [Int16] {
        var state: UInt32 = 12345
        var samples = [Int16](repeating: 0, count: Int(seconds * Double(rate)))
        for burst in bursts where burst.start < seconds {
            for index in Int(burst.start * Double(rate))..<min(samples.count, Int(burst.end * Double(rate))) {
                samples[index] = Int16((next(&state) - 0.5) * 20000)
            }
        }
        return samples
    }

    /// The cues a subtitle file has when it names every burst `late` seconds after the audio.
    private static func cues(late: Double, seconds: Double) -> [(start: Double, end: Double)] {
        bursts.filter { $0.start < seconds }.map { ($0.start + late, $0.end + late) }
    }

    private static func inBurst(_ time: Double, margin: Double) -> Bool {
        bursts.contains { time >= $0.start + margin && time < $0.end - margin }
    }

    private static func inSilence(_ time: Double, margin: Double) -> Bool {
        !bursts.contains { time >= $0.start - margin && time < $0.end + margin }
    }

    private static func speechFromCues(_ cues: [(start: Double, end: Double)], seconds: Double, frameMs: Int = 10) -> [Bool] {
        let frames = Int(seconds * 1000) / frameMs
        return (0..<frames).map { frame in
            let time = Double(frame * frameMs) / 1000
            return cues.contains { time >= $0.start && time < $0.end }
        }
    }

    private static func writeWav(_ samples: [Int16], to file: URL) throws {
        var data = Data()
        func put(_ value: UInt32) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        func put(_ value: UInt16) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        data.append(contentsOf: Array("RIFF".utf8))
        put(UInt32(36 + samples.count * 2))
        data.append(contentsOf: Array("WAVEfmt ".utf8))
        put(UInt32(16))
        put(UInt16(1))
        put(UInt16(1))
        put(UInt32(rate))
        put(UInt32(rate * 2))
        put(UInt16(2))
        put(UInt16(16))
        data.append(contentsOf: Array("data".utf8))
        put(UInt32(samples.count * 2))
        samples.withUnsafeBufferPointer { data.append(contentsOf: UnsafeRawBufferPointer($0)) }
        try data.write(to: file)
    }

    func testTheDetectorMarksTheBurstsAndNotTheSilence() {
        let speech = speechTimeline(samples: Self.burstSamples(seconds: 30), sampleRate: Self.rate)
        XCTAssertEqual(speech.count, 3000)
        var inBurst = 0, inBurstMarked = 0, inSilence = 0, inSilenceMarked = 0
        for (frame, marked) in speech.enumerated() {
            let time = Double(frame) / 100
            if Self.inBurst(time, margin: 0.1) {
                inBurst += 1
                if marked { inBurstMarked += 1 }
            } else if Self.inSilence(time, margin: 0.2) {
                inSilence += 1
                if marked { inSilenceMarked += 1 }
            }
        }
        XCTAssertGreaterThan(inBurst, 1000)
        XCTAssertGreaterThan(inSilence, 500)
        XCTAssertGreaterThan(Double(inBurstMarked) / Double(inBurst), 0.95)
        XCTAssertEqual(inSilenceMarked, 0)
    }

    func testSilenceHasNoSpeechAndNoAlignment() {
        let silence = [Int16](repeating: 0, count: 30 * Self.rate)
        let speech = speechTimeline(samples: silence, sampleRate: Self.rate)
        XCTAssertFalse(speech.contains(true))
        XCTAssertNil(alignCues(speech: speech, cues: Self.cues(late: 0, seconds: 30), windowStart: 0, coverage: 0...30))
    }

    func testCuesThatRunLateAreMovedBackByAsMuch() throws {
        let speech = Self.speechFromCues(Self.cues(late: 0, seconds: Self.seconds), seconds: Self.seconds)
        let found = try XCTUnwrap(alignCues(speech: speech, cues: Self.cues(late: 1.7, seconds: Self.seconds + 2), windowStart: 0, coverage: 0...(Self.seconds + 2)))
        XCTAssertEqual(found.offsetMs, -1700, accuracy: 20)
        XCTAssertGreaterThanOrEqual(found.confidence, 6)
        let early = try XCTUnwrap(alignCues(speech: speech, cues: Self.cues(late: -2.5, seconds: Self.seconds + 3), windowStart: 0, coverage: -3...(Self.seconds + 3)))
        XCTAssertEqual(early.offsetMs, 2500, accuracy: 20)
    }

    func testCuesUnrelatedToTheSpeechGiveNoAlignment() {
        let speech = Self.speechFromCues(Self.cues(late: 0, seconds: Self.seconds), seconds: Self.seconds)
        var state: UInt32 = 99
        var cues: [(start: Double, end: Double)] = []
        var time = 0.0
        while time < Self.seconds {
            let gap = 0.5 + Self.next(&state) * 3
            let length = 0.8 + Self.next(&state) * 2.5
            cues.append((time + gap, time + gap + length))
            time += gap + length
        }
        XCTAssertNil(alignCues(speech: speech, cues: cues, windowStart: 0, coverage: 0...Self.seconds))
    }

    func testTheCueSpansOfAWebVTTBody() {
        let spans = webVTTCueSpans("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500 line:90%\nFirst\n\n00:01.000 --> 00:03.000\nSecond\n\nNOTE x --> y\n")
        XCTAssertEqual(spans.count, 2)
        XCTAssertEqual(spans[0].start, 1, accuracy: 0.001)
        XCTAssertEqual(spans[0].end, 2.5, accuracy: 0.001)
        XCTAssertEqual(spans[1].end, 3, accuracy: 0.001)
    }

    /// The bursts as an AAC file the host ffmpeg encodes from our WAV, or nil without ffmpeg.
    private static func burstFile() -> URL? {
        guard FileManager.default.isExecutableFile(atPath: ffmpeg) else { return nil }
        let file = fixtureDir.appendingPathComponent("bursts.m4a")
        if FileManager.default.fileExists(atPath: file.path) { return file }
        let wav = fixtureDir.appendingPathComponent("bursts.wav")
        guard (try? writeWav(burstSamples(seconds: seconds), to: wav)) != nil else { return nil }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: ffmpeg)
        process.arguments = ["-hide_banner", "-loglevel", "error", "-y", "-i", wav.path, "-c:a", "aac", "-b:a", "96k", file.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return nil }
        process.waitUntilExit()
        return process.terminationStatus == 0 ? file : nil
    }

    func testAWindowReadFromAFileLinesItsCuesUpWithTheBursts() throws {
        guard let file = Self.burstFile() else { throw XCTSkip("host ffmpeg not found") }
        let window = try XCTUnwrap(readAudioWindow(inputUrl: file.absoluteString, headers: [:], audioStreamIndex: nil, from: 30, to: 150))
        XCTAssertEqual(window.startSeconds, 30)
        XCTAssertEqual(window.samples.count, 120 * Self.rate, accuracy: Self.rate / 10)
        let speech = speechTimeline(samples: window.samples, sampleRate: window.sampleRate)
        let found = try XCTUnwrap(alignCues(speech: speech, cues: Self.cues(late: 1.7, seconds: Self.seconds + 2), windowStart: window.startSeconds, coverage: 0...(Self.seconds + 2)))
        print("[SubtitleAlignerTests] file window: offset \(found.offsetMs) ms, confidence \(found.confidence)")
        XCTAssertEqual(found.offsetMs, -1700, accuracy: 100)
    }

    func testTheSessionAnswersTheWholeCorrectionOfADeviceCopy() throws {
        guard let file = Self.burstFile() else { throw XCTSkip("host ffmpeg not found") }
        var vtt = "WEBVTT\n\n"
        for (position, cue) in Self.cues(late: 1.7, seconds: Self.seconds).enumerated() {
            vtt += "\(position + 1)\n\(webVTTTimestamp(cue.start)) --> \(webVTTTimestamp(cue.end))\nLine \(position + 1)\n\n"
        }
        let copy = Self.fixtureDir.appendingPathComponent("late.vtt")
        try vtt.write(to: copy, atomically: true, encoding: .utf8)
        let track = RemuxSubtitle(index: 100_000, name: "Late", language: "eng", vttUrl: "", localVtt: copy.absoluteString, isDefault: false, isForced: false, isImage: false, isEngineText: false)
        let session = try RemuxSession(config: makeConfig(durationSeconds: Self.seconds, inputUrl: file.absoluteString, subtitles: [track]))
        guard case let .aligned(offsetMs, confidence) = session.alignSubtitleTiming(streamIndex: 100_000, attempt: 0) else {
            return XCTFail("the session did not align the copy")
        }
        print("[SubtitleAlignerTests] session: offset \(offsetMs) ms, confidence \(confidence)")
        XCTAssertEqual(offsetMs, -1700, accuracy: 100)
        XCTAssertGreaterThanOrEqual(confidence, 6)
        XCTAssertEqual(session.alignSubtitleTiming(streamIndex: 7, attempt: 0), .failed("noTrack"))
    }
}
