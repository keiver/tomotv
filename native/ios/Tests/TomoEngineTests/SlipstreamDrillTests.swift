import AVFoundation
import AppKit
import XCTest

@testable import TomoEngine

/// Slipstream drill on the host: the app's real engine config (captured by
/// test/playback/drill/engineConfig.drill.test.ts), the app's own loopback routes, macOS AVPlayer,
/// and the netsim proxy shaping the link. Records a JSONL timeline; scripts/abr-drill.mjs scores it.
///
/// Env: TOMO_DRILL_CONFIG (bridge config json), TOMO_DRILL_OUT (timeline jsonl),
/// TOMO_DRILL_PROXY (netsim base URL), TOMO_DRILL_PROFILE (json steps), TOMO_DRILL_SECONDS,
/// TOMO_DRILL_LINK (stands in for the measured link, bps),
/// TOMO_DRILL_BUFFER (preferredForwardBufferDuration, seconds), TOMO_DRILL_WINDOW=1 (render into a 1080p window),
/// TOMO_DRILL_CAP=1 (cap the variant choice to the measured link, as the app does).
final class SlipstreamDrillTests: XCTestCase {
    private var out: FileHandle?
    private let started = Date()
    private let outLock = NSLock()

    private func emit(_ kind: String, _ fields: [String: Any]) {
        var record = fields
        record["kind"] = kind
        record["ms"] = Int(Date().timeIntervalSince(started) * 1000)
        guard var data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) else { return }
        data.append(Data("\n".utf8))
        outLock.lock()
        out?.write(data)
        outLock.unlock()
    }

    /// The bridge dictionary to RemuxConfig, field for field as LocalRemuxer.startRemux reads it.
    private func config(from raw: [String: Any]) -> RemuxConfig {
        let audioTracks: [RemuxAudioTrack] = ((raw["audioTracks"] as? [[String: Any]]) ?? []).compactMap { t in
            guard let index = t["index"] as? Int else { return nil }
            var track = RemuxAudioTrack(index: index, name: t["name"] as? String ?? "Audio \(index)", language: t["language"] as? String ?? "", serverAudioUrl: t["serverAudioUrl"] as? String ?? "")
            track.serverAudioHiUrl = t["serverAudioHiUrl"] as? String ?? ""
            return track
        }
        let subtitles: [RemuxSubtitle] = ((raw["subtitles"] as? [[String: Any]]) ?? []).compactMap { s in
            guard let index = s["index"] as? Int else { return nil }
            var subtitle = RemuxSubtitle(
                index: index, name: s["name"] as? String ?? "Subtitle \(index)", language: s["language"] as? String ?? "",
                vttUrl: s["vttUrl"] as? String ?? "", localVtt: s["localVtt"] as? String ?? "",
                isDefault: s["isDefault"] as? Bool ?? false, isForced: s["isForced"] as? Bool ?? false,
                isImage: s["isImage"] as? Bool ?? false, isEngineText: s["isEngineText"] as? Bool ?? false,
                serverVttUrl: s["serverVttUrl"] as? String ?? "")
            subtitle.serverSupUrl = s["serverSupUrl"] as? String ?? ""
            return subtitle
        }
        let tiers: [TierConfig] = ((raw["tiers"] as? [[String: Any]]) ?? []).map { t in
            var tier = TierConfig(playlistUrl: t["playlistUrl"] as? String ?? "", bandwidth: t["bandwidth"] as? Int ?? 0, codecs: t["codecs"] as? String ?? "",
                                  width: t["width"] as? Int ?? 0, height: t["height"] as? Int ?? 0)
            tier.audioHi = (t["audioGroup"] as? String) == "hi"
            return tier
        }.filter { !$0.playlistUrl.isEmpty }
        return RemuxConfig(
            inputUrl: raw["inputUrl"] as? String ?? "", audioTracks: audioTracks, durationSeconds: raw["durationSeconds"] as? Double ?? 0,
            subtitles: subtitles, videoRange: raw["videoRange"] as? String ?? "SDR", supplementalCodecs: raw["supplementalCodecs"] as? String ?? "",
            codecs: raw["codecs"] as? String ?? "", width: raw["width"] as? Int ?? 0, height: raw["height"] as? Int ?? 0,
            frameRate: raw["frameRate"] as? Double ?? 0, bandwidth: raw["bandwidth"] as? Int ?? 0,
            readAheadSegments: raw["readAheadSegments"] as? Int ?? 0, tiers: tiers,
            startOffsetSeconds: raw["startOffsetSeconds"] as? Double ?? 0, itemId: raw["itemId"] as? String ?? "")
    }

    private func post(_ url: URL, json: Any) {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = try? JSONSerialization.data(withJSONObject: json)
        let done = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: request) { _, _, _ in done.signal() }.resume()
        _ = done.wait(timeout: .now() + 5)
    }

    func testDrill() throws {
        let env = ProcessInfo.processInfo.environment
        guard let configPath = env["TOMO_DRILL_CONFIG"], let outPath = env["TOMO_DRILL_OUT"] else {
            throw XCTSkip("set TOMO_DRILL_CONFIG and TOMO_DRILL_OUT (scripts/abr-drill.mjs --host)")
        }
        FileManager.default.createFile(atPath: outPath, contents: nil)
        out = FileHandle(forWritingAtPath: outPath)
        defer { try? out?.close() }

        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: configPath))) as? [String: Any])
        let seconds = Double(env["TOMO_DRILL_SECONDS"] ?? "120") ?? 120
        let deadline = Date().addingTimeInterval(seconds)
        emit("start", ["config": configPath])

        if let proxy = env["TOMO_DRILL_PROXY"].flatMap(URL.init(string:)), let profile = env["TOMO_DRILL_PROFILE"],
           let steps = try? JSONSerialization.jsonObject(with: Data(profile.utf8)) {
            post(proxy.appendingPathComponent("__netsim"), json: ["profile": steps])
        }

        // One playback attempt; returns the position to resume at when the link has recovered past
        // the source rate (the app rebuilds the session for that, since the copy is not in a master
        // written for a slower link), or nil when the run is over.
        var offset = raw["startOffsetSeconds"] as? Double ?? 0
        var attempt = 0
        while Date() < deadline {
            attempt += 1
            let resume = try playOnce(raw: raw, env: env, offset: offset, deadline: deadline, attempt: attempt)
            guard let resume else { break }
            emit("climb", ["fromPosition": resume])
            offset = resume
        }
        if let proxy = env["TOMO_DRILL_PROXY"].flatMap(URL.init(string:)) {
            post(proxy.appendingPathComponent("__netsim"), json: ["kbps": 0])
        }
    }

    private func playOnce(raw: [String: Any], env: [String: String], offset: Double, deadline: Date, attempt: Int) throws -> Double? {
        var raw = raw
        raw["startOffsetSeconds"] = offset
        let session = try RemuxSession(config: config(from: raw))
        session.onTier = { [weak self] report in self?.emit("tier", report) }
        session.start()
        defer { session.stop() }

        if let link = env["TOMO_DRILL_LINK"].flatMap(Double.init) { session.testLinkBps = link }
        let server = LocalHTTPServer { path in
            let parts = path.split(separator: "/").map(String.init)
            guard parts.count == 2, parts[0] == session.token else { return .notFound }
            if parts[1] == "master.m3u8" {
                let master = session.masterPlaylist()
                self.emit("master", ["text": master, "attempt": attempt])
                return .data(Data(master.utf8), contentType: "application/vnd.apple.mpegurl")
            }
            // A listed rung whose playlist cannot be had: the ladder must survive losing one.
            if let broken = env["TOMO_DRILL_BREAK"], parts[1] == broken { return .notFound }
            return session.route(parts[1])
        }
        server.requestObserver = { [weak self] r in
            self?.emit("req", ["path": r.path, "status": r.status, "bytes": r.bytes, "firstBodyMs": r.firstBodyMs, "doneMs": r.doneMs])
        }
        let port = try server.start()
        defer { server.stop() }
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/\(session.token)/master.m3u8"))

        let item = AVPlayerItem(url: url)
        // AVPlayerItem.h:574-579: since tvOS 13 AVPlayer picks its own opening variant. The app sets
        // this in the RNV patch, so the drill sets it too or it measures a different player.
        item.startsOnFirstEligibleVariant = true
        if let buffer = env["TOMO_DRILL_BUFFER"].flatMap(Double.init) { item.preferredForwardBufferDuration = buffer }
        let player = AVPlayer(playerItem: item)
        // AVPlayer weighs the size it renders at when it picks a variant; the app always has a screen.
        var window: NSWindow?
        if env["TOMO_DRILL_WINDOW"] == "1" {
            let frame = NSRect(x: 0, y: 0, width: 1920, height: 1080)
            let host = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
            // An NSWindow made here is released when closed, and ARC releases it again: a crash at
            // test teardown, not a playback fault.
            host.isReleasedWhenClosed = false
            let view = NSView(frame: frame)
            view.wantsLayer = true
            let layer = AVPlayerLayer(player: player)
            layer.frame = frame
            view.layer?.addSublayer(layer)
            host.contentView = view
            host.orderFrontRegardless()
            window = host
        }
        defer { window?.orderOut(nil) }
        defer { player.pause() }

        var loggedEvents = 0
        var readyAt: Int?
        var firstFrameAt: Int?
        var lastPosition = -1.0
        var clearedSourceSince: Date?
        let sourceBps = Double(raw["bandwidth"] as? Int ?? 0)
        player.play()

        while Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.5))
            let now = Int(Date().timeIntervalSince(started) * 1000)
            if readyAt == nil, item.status == .readyToPlay { readyAt = now; emit("ready", ["attempt": attempt]) }
            if item.status == .failed {
                emit("failed", ["error": String(describing: item.error)])
                break
            }
            let position = player.currentTime().seconds
            if firstFrameAt == nil, position > offset + 0.2 {
                firstFrameAt = now
                emit("firstFrame", ["position": position])
                // As the app does: the short forward buffer gets the picture up, then AVPlayer
                // builds its own depth, which is what a link drop is survived on.
                item.preferredForwardBufferDuration = 0
            }
            let buffered = item.loadedTimeRanges.map { $0.timeRangeValue }.first { CMTimeRangeContainsTime($0, time: player.currentTime()) }
            let ahead = buffered.map { CMTimeGetSeconds(CMTimeRangeGetEnd($0)) - position } ?? 0
            emit("tick", [
                "position": position.isFinite ? position : -1,
                "ahead": ahead,
                "status": player.timeControlStatus.rawValue,
                "waiting": player.reasonForWaitingToPlay?.rawValue ?? "",
                "advanced": position > lastPosition + 0.05,
                "linkMbps": (session.pacedLinkBps ?? 0) / 1_000_000,
            ])
            lastPosition = position
            // What the app does with the engine's measurement: cap the variant choice to the
            // measured link, so AVPlayer picks from what the link carries instead of the loopback.
            if env["TOMO_DRILL_CAP"] == "1", let bps = session.pacedLinkBps {
                // Same floor as the app: a cap under every variant leaves AVPlayer nothing to play.
                let floor = Double(session.config.tiers.map(\.bandwidth).min() ?? 0)
                let cap = max(bps * 0.8, floor)
                if abs((item.preferredPeakBitRate == 0 ? .infinity : item.preferredPeakBitRate) - cap) > cap * 0.15 {
                    item.preferredPeakBitRate = cap
                    emit("cap", ["mbps": cap / 1_000_000])
                }
            }
            let events = item.accessLog()?.events ?? []
            for event in events.dropFirst(loggedEvents) {
                emit("access", ["uri": event.uri ?? "", "indicated": event.indicatedBitrate, "observed": event.observedBitrate,
                                "switch": event.switchBitrate, "stalls": event.numberOfStalls, "bytes": event.numberOfBytesTransferred,
                                "transfer": event.transferDuration, "segments": event.numberOfMediaRequests])
            }
            if let last = events.last {
                emit("estimate", ["uri": last.uri ?? "", "indicated": last.indicatedBitrate, "observed": last.observedBitrate, "stalls": last.numberOfStalls])
            }
            loggedEvents = events.count

            // The copy is missing from a master written for a slower link, so a recovered link is
            // climbed by rebuilding the session at the playhead. Sustained, not a single sample, and
            // on the engine's own word that a copy is there to reach, as the app takes it.
            if !session.reportsCopyListed, position > offset + 1, let bps = session.pacedLinkBps, sourceBps > 0 {
                if bps >= sourceBps * 1.2 {
                    if let since = clearedSourceSince, Date().timeIntervalSince(since) >= 5 {
                        for event in item.errorLog()?.events ?? [] {
                            emit("errorLog", ["uri": event.uri ?? "", "status": event.errorStatusCode, "domain": event.errorDomain, "comment": event.errorComment ?? ""])
                        }
                        return position
                    }
                    if clearedSourceSince == nil { clearedSourceSince = Date() }
                } else {
                    clearedSourceSince = nil
                }
            }
        }

        let group = DispatchSemaphore(value: 0)
        var audible = 0
        var legible = 0
        Task {
            audible = (try? await item.asset.loadMediaSelectionGroup(for: .audible))?.options.count ?? 0
            legible = (try? await item.asset.loadMediaSelectionGroup(for: .legible))?.options.count ?? 0
            group.signal()
        }
        while group.wait(timeout: .now()) == .timedOut { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
        for event in item.errorLog()?.events ?? [] {
            emit("errorLog", ["uri": event.uri ?? "", "status": event.errorStatusCode, "domain": event.errorDomain, "comment": event.errorComment ?? ""])
        }
        emit("end", ["audible": audible, "legible": legible, "readyMs": readyAt ?? -1, "firstFrameMs": firstFrameAt ?? -1, "position": player.currentTime().seconds])
        return nil
    }
}
