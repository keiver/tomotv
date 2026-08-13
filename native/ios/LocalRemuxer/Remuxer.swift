//
//  Remuxer.swift
//  TomoTV
//
//  On-device remux engine: reads the original file from Jellyfin over HTTP
//  (byte-range capable /stream?Static=true), stream-copies the video and the
//  selected audio track into fragmented-MP4 HLS segments on disk, and models
//  the session AVPlayer sees through LocalHTTPServer (hand-written VOD
//  playlists + numbered .m4s segments).
//
//  Why this shape: AVPlayer cannot ingest decoded frames, but it plays fMP4
//  HLS natively with its own transport UI. Rewrapping the container costs
//  roughly a file copy (no decode, no encode), so an Apple TV does it in
//  stride and the server never spawns a transcode session.
//
//  Video AVPlayer cannot decode at all (VP8/VP9, MPEG-2, MPEG-4/DivX, WMV,
//  VC-1, ...) rides the same pipeline through VideoTranscoder: software
//  decode + VideoToolbox H.264 encode, gated by resolution/format in
//  services/localRemux.ts. Segments on that path are cut on ENCODED packets
//  and forced to open on an IDR, which the copy path cannot guarantee.
//
//  Seeking follows Jellyfin's own strategy: the media playlist claims the
//  whole duration upfront in uniform segments, and a request for a segment
//  far from the producer's position restarts the pipeline at the keyframe at
//  or before that segment's start. Output timestamps are never bent to make
//  that keyframe look like it sits on the boundary: one session-wide anchor
//  means presentation time always equals source media time, which is what
//  keeps the WebVTT rendition (absolute source times, served straight from
//  Jellyfin and never rebased) aligned with the picture across seeks. The
//  cost is that the generation re-muxes from the keyframe forward, so its
//  opening segment can be short at the head; that one is discarded rather
//  than published.
//
//  The mov muxer enforces monotonic DTS across fragments, so every
//  seek-restart tears down and rebuilds the OUTPUT context (input stays open
//  and just seeks). The mov muxer normalizes each rebuilt track's timeline to
//  its first packet, so finishSegment() patches every tfdt back to absolute
//  position (see patchTfdtToAbsolute); that keeps the native seek bar
//  truthful even though real fragment boundaries sit on keyframes rather
//  than exact 6-second marks, and keeps segments from different generations
//  interchangeable in one AVPlayer buffer.
//
//  The FFmpeg build ships no hls/segment muxer (it comes from MPVKit, built
//  for mpv, which never muxes), so segmentation is done here: the mp4 muxer
//  runs with frag_custom into a custom write callback, and every explicit
//  fragment flush closes one .m4s file.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

// FFmpeg's error/constant macros don't survive the Clang importer.
private let SWIFT_AVERROR_EOF: Int32 = -541_478_725 // FFERRTAG('E','O','F',' ')
private let SWIFT_AVERROR_EXIT: Int32 = -1_414_092_869 // FFERRTAG('E','X','I','T')
private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)
private let SWIFT_AV_TIME_BASE: Int32 = 1_000_000
private let SWIFT_AV_PKT_FLAG_KEY: Int32 = 0x0001
private let SWIFT_AVSEEK_FLAG_BACKWARD: Int32 = 1

private func averr(_ code: Int32) -> String {
    var buf = [CChar](repeating: 0, count: 128)
    av_strerror(code, &buf, buf.count)
    return String(cString: buf)
}

/// One subtitle rendition surfaced in the master playlist. For a text track
/// `vttUrl` points at Jellyfin's WebVTT endpoint and the local "playlist" is a
/// single full-duration segment, which AVPlayer accepts.
struct RemuxSubtitle {
    let index: Int
    let name: String
    let language: String
    let vttUrl: String
    let isDefault: Bool
    /// Carries dialogue the viewer is meant to see without turning subtitles on
    /// (foreign speech, signs). Reaches the playlist as AUTOSELECT=YES, never as
    /// FORCED=YES: see masterPlaylist() for the device measurement that killed
    /// that attribute. These used to be burned into the picture instead.
    let isForced: Bool
    /// A bitmap track (PGS, DVD/VobSub, DVB, XSUB). Jellyfin cannot render one
    /// as WebVTT, so `vttUrl` is empty and the rendition serves a cue-less
    /// playlist instead: proven on a real Apple TV to be listed and selectable
    /// in AVKit's picker while drawing nothing, which leaves the picture to us.
    /// The images come from ImageSubtitleDecoder.
    let isImage: Bool
}

/// One selectable audio track. With several tracks, every one becomes its own
/// audio-only rendition and the variant is video-only; a lone track is muxed
/// with the video as before. Ordering is the contract: the JS caller
/// (services/localRemux.ts) sorts the preferred track first (user selection,
/// else Jellyfin's default) and masterPlaylist() marks position 0 DEFAULT=YES.
struct RemuxAudioTrack {
    /// ffprobe/Jellyfin stream index in the source file.
    let index: Int
    let name: String
    let language: String
}

struct RemuxConfig {
    let inputUrl: String
    /// Every audio track to expose, default first. Empty means "pick the best
    /// audio stream in the file".
    let audioTracks: [RemuxAudioTrack]
    let durationSeconds: Double
    let subtitles: [RemuxSubtitle]
    /// HLS VIDEO-RANGE for the variant: "SDR", "PQ" (HDR10) or "HLG". Comes
    /// from Jellyfin's stream metadata (services/localRemux.ts) because the
    /// master playlist is served before FFmpeg has parsed the input. Required
    /// by Apple's HLS spec; AVFoundation hard-fails PQ content in a variant
    /// that doesn't declare it (-12927, found by the HDR10 harness run).
    let videoRange: String
    /// RFC 6381 CODECS for the variant (e.g. "hvc1.2.4.L123.B0,mp4a.40.2").
    /// Empty omits the attribute. Required alongside a non-SDR VIDEO-RANGE:
    /// AVFoundation refuses to select a PQ/HLG variant whose codec support it
    /// cannot verify, and with no selectable variant the whole master fails.
    let codecs: String
}

/// A single remux session: FFmpeg pipeline + segment store + playlist model.
/// One session exists at a time (mirrors MultiAudioResourceLoader's model).
final class RemuxSession {
    static let segmentDuration = 6.0
    /// Keep producing this many segments past the one AVPlayer last asked for,
    /// then idle. Prevents eagerly downloading a whole 20GB file.
    private static let aheadWindow = 5
    /// Half-width of the on-disk window kept around the playhead. Segments
    /// outside it are deleted; the producer can always regenerate them with a
    /// seek-restart, so this only bounds disk use.
    private static let keepWindow = 20

    let token = UUID().uuidString
    private let config: RemuxConfig
    private let dir: URL

    private let stateLock = NSLock()
    /// Primary rendition first, then one per alternate audio track. Built on
    /// the pipeline thread before production starts; the serving side reads it
    /// under the lock.
    private var renditions: [Rendition] = []
    private var producingSegment = 0
    /// The segment AVPlayer asked for most recently — the playhead. Note this
    /// is NOT a high-water mark: after seeking backwards it must move back, or
    /// the producer would stay throttled and freshly written segments would be
    /// pruned the instant they landed.
    private var lastRequestedSegment = 0
    /// Set once the input hits EOF. `lastProducedSegment` is then the highest
    /// segment the real stream actually yielded, which can be below the last
    /// index the playlist declares when the container runs slightly shorter
    /// than the runtime Jellyfin reported.
    private var reachedEnd = false
    private var lastProducedSegment = 0

    private var pendingSeekSegment: Int? = nil
    /// Segment indices with a live segmentURL() request currently waiting on
    /// them, with a count per index (renditions can wait on the same n
    /// concurrently). The producer refuses to throttle while one of these sits
    /// inside its production window.
    private var activeWaiters: [Int: Int] = [:]
    private var cancelled = false
    private var failed = false

    /// Image subtitle decoders by input stream index, built once the input is
    /// open. Written on the pipeline thread, read on the HTTP queue when the app
    /// asks for a cue manifest, so every touch goes through `stateLock`.
    private var imageSubtitles: [Int32: ImageSubtitleDecoder] = [:]

    /// Furthest source time the read loop has actually reached, in seconds.
    ///
    /// A seek abandons everything past this point, and the subtitle decoders
    /// need to know where their knowledge stops: their model is "the last
    /// display set wins", so without it a subtitle from before a seek would be
    /// painted over a region we never read. Pipeline thread only.
    private var demuxedUpTo: Double = 0

    /// Floor, not ceil: the remainder folds into the FINAL segment (which then
    /// runs 6..<12s) instead of becoming a sub-second segment of its own. A
    /// file of 90.018s would otherwise declare a 16th segment holding 18ms
    /// that the producer can never fill — the last packet sits below the 90s
    /// boundary, EOF hits, and AVPlayer turns the declared-but-missing segment
    /// into a hard -1100 error in the final second of playback.
    var segmentCount: Int {
        max(1, Int(config.durationSeconds / Self.segmentDuration))
    }

    /// Delete session directories that no live session owns — what a crash or a
    /// force-quit leaves behind. Called on start with the tokens still in use,
    /// since nothing else prunes the cache now that init no longer wipes it.
    static func sweepOrphans(keeping liveTokens: Set<String>) {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let root = caches.appendingPathComponent("localremux", isDirectory: true)
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: root.path) else { return }
        for name in entries where !liveTokens.contains(name) {
            try? FileManager.default.removeItem(at: root.appendingPathComponent(name))
        }
    }

    /// Called once, on the pipeline thread, as soon as the engine has decided
    /// what to do with every stream. The payload is the dictionary
    /// `LocalRemuxer` forwards to JS as `onEnginePlan`. Set before `start()`.
    var onPlan: (([String: Any]) -> Void)?

    /// What `reportPlan` last published, so a seek-restart that reaches the same
    /// decisions stays quiet instead of re-emitting on every seek.
    private var lastPlanSignature: String?

    init(config: RemuxConfig) throws {
        self.config = config
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let root = caches.appendingPathComponent("localremux", isDirectory: true)
        // Only this session's own directory is created here. This used to wipe
        // the whole root, which deleted the segments of any session still being
        // served — the overlapping-player freeze. Sessions clean up after
        // themselves in stop(); `sweepOrphans` handles anything a crash left.
        dir = root.appendingPathComponent(token, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    // MARK: - Lifecycle

    func start() {
        let thread = Thread { [weak self] in
            self?.runPipeline()
        }
        thread.name = "tv.tomo.localremux"
        thread.qualityOfService = .userInitiated
        thread.start()
    }

    func stop() {
        stateLock.lock()
        cancelled = true
        stateLock.unlock()
        // The pipeline thread notices `cancelled` between packets (or through
        // the AVIO interrupt callback during a blocking read) and exits; the
        // directory is removed on the next session's init as well.
        try? FileManager.default.removeItem(at: dir)
    }

    private var isCancelled: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return cancelled
    }

    // MARK: - Playlists

    func masterPlaylist() -> String {
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n"

        // Audio renditions. Every track points at its own audio-only playlist
        // — none is muxed into the variant. A muxed (URI-less) rendition gets
        // its picker label from the embedded stream metadata, not from NAME:
        // an "und" track showed as "Unknown", and which track wore which label
        // style changed with the mux order on every rebuild. All-URI renditions
        // are labelled from NAME consistently, same as the server-side
        // multi-audio path.
        //
        // LANGUAGE is emitted on every rendition, "und" included. Apple's HLS
        // authoring specification requires it: req 4.7 for a subtitles track,
        // req 8.10 for every EXT-X-MEDIA tag that is not TYPE=VIDEO. "und" is
        // the BCP 47 subtag for undetermined and is what an untagged track is.
        //
        // This used to be omitted for "und", justified by a comment claiming
        // iOS always prefers LANGUAGE for the picker label so leaving it out
        // was what made NAME show. The device log contradicts that: T06 ships
        // LANGUAGE="eng" and onTextTracks still reported NAME as the track's
        // title. Note the log settles the option's common metadata title, not
        // what AVKit paints in the picker row, which is a different field
        // (AVMediaSelectionOption.displayName, documented only as "may use"
        // common metadata). If a device run ever shows the rows collapsing to
        // a language name, that is the tradeoff to revisit — not this comment.
        if config.audioTracks.count > 1 {
            for (position, track) in config.audioTracks.enumerated() {
                let name = track.name.replacingOccurrences(of: "\"", with: "")
                var line = "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"\(name)\""
                line += ",LANGUAGE=\"\(track.language.isEmpty ? "und" : track.language)\""
                // RFC 8216: when DEFAULT is YES, AUTOSELECT must also be YES if
                // present. Emitting DEFAULT=YES,AUTOSELECT=NO makes
                // AVFoundation reject the whole master playlist (-12642).
                line += position == 0 ? ",DEFAULT=YES,AUTOSELECT=YES" : ",DEFAULT=NO,AUTOSELECT=NO"
                line += ",URI=\"\(audioPrefix(position)).m3u8\""
                out += line + "\n"
            }
        }

        // RFC 8216 §4.3.4.1 also forbids a group from carrying more than one
        // member with DEFAULT=YES, and Matroska is happy to flag several
        // subtitle tracks as default at once. Emitting them all costs the whole
        // file, not just its subtitles, because AVFoundation rejects the master
        // playlist outright. First default wins, the rest are demoted.
        let defaultSubtitle = config.subtitles.firstIndex(where: { $0.isDefault })

        for (position, sub) in config.subtitles.enumerated() {
            let name = sub.name.replacingOccurrences(of: "\"", with: "")
            let isDefault = position == defaultSubtitle
            var line = "#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"subs\",NAME=\"\(name)\""
            line += ",LANGUAGE=\"\(sub.language.isEmpty ? "und" : sub.language)\""
            // Same RFC 8216 rule as the audio group: DEFAULT=YES requires
            // AUTOSELECT=YES. A file carrying a default subtitle (very common
            // in MKV rips) otherwise makes AVFoundation reject the entire
            // master playlist with a bare -12642.
            //
            // A forced track is AUTOSELECT=YES too, without being DEFAULT: it
            // must be presentable on its own (it carries dialogue the viewer is
            // meant to see) but must not switch on a full subtitle track for
            // someone who never asked for one.
            line += isDefault ? ",DEFAULT=YES" : ",DEFAULT=NO"
            line += isDefault || sub.isForced ? ",AUTOSELECT=YES" : ",AUTOSELECT=NO"
            // FORCED=YES is never emitted, whatever the source flags say.
            //
            // AVFoundation treats a forced rendition as something it applies on
            // the viewer's behalf rather than something the viewer chooses, so
            // it withholds it from AVKit's picker and never reports it as the
            // current media selection. What it then does NOT do is apply it.
            // Three files from one device session, differing in this attribute
            // alone, measured 2026-08-13:
            //
            //   T06, one PGS track, FORCED=NO,  eng default: selection held,
            //        listed in the picker, drawn.
            //   T07, ten SUBRIP tracks, FORCED=NO, deu default: automatic
            //        selection cleared, still listed, manual picks hold.
            //   T05, one SUBRIP track, FORCED=YES, eng default: selection
            //        cleared 0.4s into playback, before its first cue at
            //        2.253s, and NO picker entry at all. Played from zero with
            //        two cues inside the window watched, nothing was drawn.
            //
            // So the attribute's only observed effect here is that the viewer
            // loses the track outright. DEFAULT=YES and AUTOSELECT=YES carry
            // the intent instead: a forced track still presents itself without
            // being asked for, and stays something the viewer can switch off.
            //
            // The cost is AVKit's "Auto" subtitle entry, which keys off exactly
            // this attribute. It buys nothing: a rendition AVKit will neither
            // offer nor render cannot be shown by any mode.
            //
            // There is no "emit it only when the group also holds a selectable
            // track" branch. No file in the test library pairs a forced track
            // with a non-forced one, so such a branch could not be verified.
            line += ",FORCED=NO"
            line += ",URI=\"sub\(sub.index).m3u8\"\n"
            out += line
        }

        out += "#EXT-X-STREAM-INF:BANDWIDTH=20000000"
        // Unquoted enumerated value per RFC 8216 §4.3.4.2.
        out += ",VIDEO-RANGE=\(config.videoRange)"
        if !config.codecs.isEmpty {
            // Authoring spec req 5.10 says the subtitle kind SHOULD appear here
            // as "wvtt". Deliberately not emitted. It is a SHOULD, the attribute
            // is one AVPlayer hard-rejects when it disagrees, and CODECS is only
            // present at all on HDR variants — of which the regression suite has
            // exactly one, T10, which carries no subtitles. Nothing we own can
            // prove the token is harmless, and its failure mode is the whole
            // file refusing to play. Add a PQ fixture with a subtitle track
            // first, then revisit.
            out += ",CODECS=\"\(config.codecs)\""
        }
        if config.audioTracks.count > 1 {
            out += ",AUDIO=\"audio\""
        }
        if !config.subtitles.isEmpty {
            out += ",SUBTITLES=\"subs\""
        }
        out += "\nmedia.m3u8\n"
        return out
    }

    /// Rendition prefix for the alternate audio track at `position` (>= 1).
    private func audioPrefix(_ position: Int) -> String { "a\(position)" }

    /// Media playlist for a rendition. `prefix` is "" for the primary
    /// (video + default audio) and "aN" for an alternate audio track; the
    /// segment timeline is identical across all of them, because every
    /// rendition is cut on the same boundaries.
    func mediaPlaylist(prefix: String = "") -> String {
        let segDur = Self.segmentDuration
        let initName = prefix.isEmpty ? "init.mp4" : "\(prefix)-init.mp4"
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n"
        // Must cover the final segment, which absorbs the duration remainder
        // and can run just under 2x the nominal segment length.
        out += "#EXT-X-TARGETDURATION:\(Int(ceil(segDur * 2)))\n"
        out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n"
        out += "#EXT-X-MAP:URI=\"\(initName)\"\n"
        let count = segmentCount
        for n in 0..<count {
            let dur = n == count - 1
                ? max(0.001, config.durationSeconds - Double(n) * segDur)
                : segDur
            out += String(format: "#EXTINF:%.6f,\n", dur)
            out += prefix.isEmpty ? "seg\(n).m4s\n" : "\(prefix)-seg\(n).m4s\n"
        }
        out += "#EXT-X-ENDLIST\n"
        return out
    }

    /// Subtitle "playlist": one full-length WebVTT segment. For a text track it
    /// is fetched straight from Jellyfin, which keeps subtitle bytes off this
    /// server. An image track points at our own cue-less `subN.vtt` instead.
    func subtitlePlaylist(streamIndex: Int) -> String? {
        guard let sub = config.subtitles.first(where: { $0.index == streamIndex }) else { return nil }
        let dur = max(1, Int(ceil(config.durationSeconds)))
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n"
        out += "#EXT-X-TARGETDURATION:\(dur)\n"
        out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n"
        out += String(format: "#EXTINF:%.3f,\n", config.durationSeconds)
        out += sub.isImage ? "sub\(sub.index).vtt\n" : "\(sub.vttUrl)\n"
        out += "#EXT-X-ENDLIST\n"
        return out
    }

    /// The body an image track's rendition resolves to: a structurally valid
    /// WebVTT file with no cues at all.
    ///
    /// Step 0 of this feature measured all three ways of making a rendition
    /// silent on a real Apple TV. Cues with a zero-width-space payload draw an
    /// empty caption box; cues pushed off-screen with `line:-200%` get clamped
    /// back into the title-safe area and draw their text. Only a track with no
    /// active cue draws nothing, because AVKit paints a caption background for
    /// any cue that is active. That is exactly the shape an image track needs.
    ///
    /// The X-TIMESTAMP-MAP is required of WebVTT segments by the authoring
    /// specification (req 5.3). Identity mapping, because the engine's own
    /// timeline starts at zero — unlike Jellyfin's WebVTT, which stamps
    /// MPEGTS:900000 and displaced every cue by 10 seconds when a file went
    /// through the server's HLS subtitle path.
    func emptySubtitleBody() -> String {
        "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n\n"
    }

    /// Display-set manifest for an image subtitle track, or nil if that stream
    /// is not one. Served to the app, which draws the images itself.
    func subtitleCueManifest(streamIndex: Int) -> Data? {
        stateLock.lock()
        let decoder = imageSubtitles[Int32(streamIndex)]
        let readUpTo = demuxedUpTo
        stateLock.unlock()
        return decoder?.manifestJSON(demuxedUpTo: readUpTo)
    }

    /// On-disk PNG for an image subtitle cue, addressed by its file name.
    func subtitleImageURL(_ name: String) -> URL? {
        let url = dir.appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    // MARK: - Segment serving

    func initSegmentURL(prefix: String = "") -> URL? {
        let name = prefix.isEmpty ? "init.mp4" : "\(prefix)-init.mp4"
        let url = dir.appendingPathComponent(name)
        // Written when the rendition's muxer is built, which happens as the
        // pipeline starts. AVPlayer asks for it before any segment. A failed
        // session (e.g. the video transcoder refusing the pixel format)
        // answers immediately instead of running out the clock, so the player
        // reaches its server fallback in milliseconds rather than 25s.
        _ = waitUntil(deadline: 25) { [weak self] in
            guard let self else { return true }
            if FileManager.default.fileExists(atPath: url.path) { return true }
            self.stateLock.lock()
            defer { self.stateLock.unlock() }
            return self.failed || self.cancelled
        }
        stateLock.lock()
        let dead = failed || cancelled
        stateLock.unlock()
        return !dead && FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Blocking (bounded) fetch of a segment file, driving seek-restarts when
    /// the player jumps outside the producer's window. `prefix` selects the
    /// rendition ("" = primary, "aN" = alternate audio).
    func segmentURL(_ n: Int, prefix: String = "") -> URL? {
        guard n >= 0 && n < segmentCount else { return nil }
        guard let rendition = rendition(withPrefix: prefix) else { return nil }

        stateLock.lock()
        lastRequestedSegment = n
        let done = rendition.completed.contains(n)
        let producing = producingSegment
        let sessionFailed = failed
        // Past the real end of the stream: nothing will ever produce this, so
        // answer immediately instead of waiting out the segment timeout.
        let pastEnd = reachedEnd && n > lastProducedSegment
        stateLock.unlock()
        if sessionFailed || (pastEnd && !done) { return nil }

        let url = dir.appendingPathComponent(rendition.segmentName(n))
        if done { return url }

        // Outside the imminent window: restart the pipeline at this segment.
        if n < producing || n > producing + Self.aheadWindow {
            stateLock.lock()
            pendingSeekSegment = n
            stateLock.unlock()
        }

        // Register as an active waiter for the duration of the wait: the
        // producer never throttles while an uncompleted segment inside its
        // window has one (see the control block in runPipeline), so this
        // request can't starve because the playhead marker was dragged
        // backwards by another request in the meantime.
        stateLock.lock()
        activeWaiters[n, default: 0] += 1
        stateLock.unlock()
        defer {
            stateLock.lock()
            if let count = activeWaiters[n], count > 1 { activeWaiters[n] = count - 1 } else { activeWaiters[n] = nil }
            stateLock.unlock()
        }

        // Bounded wait that re-asserts the seek when stranded.
        // pendingSeekSegment is last-writer-wins and consumed once, and the
        // HTTP server routes requests concurrently, so two racing requests can
        // overwrite each other's restart; the loser would otherwise wait out
        // the full deadline and 404 a segment the VOD playlist promises —
        // AVPlayer answers that by abandoning the seek position and snapping
        // back to its buffer (this shipped once: a resume at 226s snapped to
        // ~0s and the back-out's Stopped report wiped the server resume
        // point). Only a waiter near the playhead re-asserts, so an obsolete
        // request left over from a scrub can't drag the producer around.
        let deadline = Date().addingTimeInterval(20)
        var ticks = 0
        while Date() < deadline {
            stateLock.lock()
            let completed = rendition.completed.contains(n)
            let dead = failed || cancelled
            let ended = reachedEnd && n > lastProducedSegment
            let producingNow = producingSegment
            if !completed && !dead && !ended && ticks >= 20 && ticks % 10 == 0
                && pendingSeekSegment == nil
                && (n < producingNow || n > producingNow + Self.aheadWindow)
                && abs(n - lastRequestedSegment) <= Self.aheadWindow {
                pendingSeekSegment = n
                NSLog("[LocalRemuxer] Re-asserting seek for stranded segment %d (producing %d)", n, producingNow)
            }
            stateLock.unlock()
            if completed || dead || ended { break }
            ticks += 1
            usleep(100_000)
        }

        stateLock.lock()
        let ok = rendition.completed.contains(n)
        let producingAtEnd = producingSegment
        let playheadAtEnd = lastRequestedSegment
        stateLock.unlock()
        if !ok {
            NSLog("[LocalRemuxer] Segment request %d%@ unserved (producing %d, playhead %d)",
                  n, prefix.isEmpty ? "" : " [\(prefix)]", producingAtEnd, playheadAtEnd)
        }
        return ok ? url : nil
    }

    private func rendition(withPrefix prefix: String) -> Rendition? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return renditions.first { $0.prefix == prefix }
    }

    private func waitUntil(deadline seconds: Double, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if condition() { return true }
            usleep(100_000)
        }
        return condition()
    }

    // MARK: - FFmpeg pipeline

    /// Interrupt callback: aborts blocking network I/O when the session dies.
    private static let interruptCallback: @convention(c) (UnsafeMutableRawPointer?) -> Int32 = { opaque in
        guard let opaque else { return 0 }
        let session = Unmanaged<RemuxSession>.fromOpaque(opaque).takeUnretainedValue()
        return session.isCancelled ? 1 : 0
    }

    /// Muxer output goes to the rendition that owns the AVIO context, so the
    /// opaque pointer is the Rendition rather than the session. Touched only
    /// from the pipeline thread (every av_* output call happens there).
    private static let writeCallback: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<UInt8>?, Int32) -> Int32 = { opaque, buf, size in
        guard let opaque, let buf, size > 0 else { return size }
        let rendition = Unmanaged<Rendition>.fromOpaque(opaque).takeUnretainedValue()
        rendition.pending.append(buf, count: Int(size))
        return size
    }

    /// Byte offset of the first `moof` box, walking the ISO-BMFF box chain
    /// rather than scanning for the literal, so payload bytes can never be
    /// mistaken for a box header. Returns 0 when the data already starts with
    /// a fragment, nil when no `moof` is present.
    private static func firstFragmentOffset(in data: Data) -> Int? {
        var offset = 0
        while offset + 8 <= data.count {
            let size = data.withUnsafeBytes { raw -> UInt64 in
                let b = raw.baseAddress!.advanced(by: offset).assumingMemoryBound(to: UInt8.self)
                return (UInt64(b[0]) << 24) | (UInt64(b[1]) << 16) | (UInt64(b[2]) << 8) | UInt64(b[3])
            }
            let type = String(decoding: data[(offset + 4)..<(offset + 8)], as: UTF8.self)
            if type == "moof" { return offset }

            var boxSize = size
            if boxSize == 1 {
                // 64-bit largesize follows the header
                guard offset + 16 <= data.count else { return nil }
                boxSize = data.withUnsafeBytes { raw -> UInt64 in
                    let b = raw.baseAddress!.advanced(by: offset + 8).assumingMemoryBound(to: UInt8.self)
                    return (0..<8).reduce(UInt64(0)) { ($0 << 8) | UInt64(b[$1]) }
                }
            }
            guard boxSize >= 8 else { return nil }
            offset += Int(boxSize)
        }
        return nil
    }

    /// Add each track's generation-start DTS back onto every tfdt in the
    /// segment, making baseMediaDecodeTime absolute. The mov muxer normalizes
    /// a track's timeline to the first packet it sees, so without this every
    /// seek-restart produces fragments claiming the file starts over at t=0.
    /// `offsets` maps mp4 track_id (1-based, stream order) to the value to
    /// add, already in that track's timescale (the muxer rewrites the output
    /// stream time base to 1/timescale at write_header, so recorded DTS
    /// values are in the right units).
    private static func patchTfdtToAbsolute(in data: inout Data, offsets: [UInt32: Int64]) {
        func u32(_ at: Int) -> UInt32 {
            (UInt32(data[at]) << 24) | (UInt32(data[at + 1]) << 16) | (UInt32(data[at + 2]) << 8) | UInt32(data[at + 3])
        }
        func u64(_ at: Int) -> UInt64 {
            (0..<8).reduce(UInt64(0)) { ($0 << 8) | UInt64(data[at + $1]) }
        }
        func put(_ value: UInt64, at: Int, bytes: Int) {
            for i in 0..<bytes {
                data[at + i] = UInt8((value >> (8 * (bytes - 1 - i))) & 0xFF)
            }
        }
        func boxType(_ at: Int) -> String { String(decoding: data[(at + 4)..<(at + 8)], as: UTF8.self) }

        var offset = 0
        while offset + 8 <= data.count {
            let size = Int(u32(offset))
            guard size >= 8, offset + size <= data.count else { return }
            if boxType(offset) == "moof" {
                var trafOffset = offset + 8
                while trafOffset + 8 <= offset + size {
                    let trafSize = Int(u32(trafOffset))
                    guard trafSize >= 8, trafOffset + trafSize <= offset + size else { break }
                    if boxType(trafOffset) == "traf" {
                        var trackId: UInt32 = 0
                        var child = trafOffset + 8
                        while child + 8 <= trafOffset + trafSize {
                            let childSize = Int(u32(child))
                            guard childSize >= 8, child + childSize <= trafOffset + trafSize else { break }
                            switch boxType(child) {
                            case "tfhd":
                                trackId = u32(child + 12)
                            case "tfdt":
                                guard let add = offsets[trackId], add != 0 else { break }
                                // Clamped at 0: an AAC encoder's priming makes a
                                // generation's first audio DTS slightly negative,
                                // and 0 + (-1024) must not wrap around.
                                let version = data[child + 8]
                                if version == 1 {
                                    let absolute = Int64(bitPattern: u64(child + 12)) &+ add
                                    put(UInt64(max(0, absolute)), at: child + 12, bytes: 8)
                                } else {
                                    let absolute = Int64(u32(child + 12)) &+ add
                                    put(UInt64(max(0, absolute)), at: child + 12, bytes: 4)
                                }
                            default:
                                break
                            }
                            child += childSize
                        }
                    }
                    trafOffset += trafSize
                }
            }
            offset += size
        }
    }

    /// Segment type box every HLS fMP4 media segment must start with
    /// (major brand "msdh", compatible with "msdh"/"msix"). AVFoundation
    /// refuses to decode segments that lack it, even though the fragments
    /// themselves are valid.
    private static let stypBox: Data = {
        var box = Data()
        box.append(contentsOf: [0, 0, 0, 24])
        box.append(contentsOf: Array("styp".utf8))
        box.append(contentsOf: Array("msdh".utf8))
        box.append(contentsOf: [0, 0, 0, 0])
        box.append(contentsOf: Array("msdh".utf8))
        box.append(contentsOf: Array("msix".utf8))
        return box
    }()

    private func fail(_ message: String) {
        NSLog("[LocalRemuxer] Pipeline failed: %@", message)
        stateLock.lock()
        failed = true
        stateLock.unlock()
    }

    /// One output rendition: its own mp4 muxer, its own byte buffer, its own
    /// segment files. The primary rendition carries video plus the default
    /// audio track; each alternate audio track gets an audio-only rendition so
    /// HLS can offer it for selection.
    ///
    /// The muxer is rebuilt from scratch on every seek-restart because it
    /// requires monotonic DTS across fragments, but the box itself (and its
    /// file naming and completed-segment bookkeeping) outlives that.
    private final class Rendition {
        /// "" for the primary, "a1"/"a2"… for alternate audio. Also the file
        /// prefix, so the primary keeps the plain init.mp4/segN.m4s names.
        let prefix: String
        /// Input stream indices this rendition carries.
        let inputStreams: [Int32]
        /// Present when this rendition's audio has to be re-encoded (FLAC where
        /// the source allows it, AAC otherwise); nil means the audio is copied.
        var transcoder: AudioTranscoder?
        /// Present when the video codec needs re-encoding to H.264. Primary
        /// rendition only; alternates are audio-only.
        var videoTranscoder: VideoTranscoder?

        var ctx: UnsafeMutablePointer<AVFormatContext>?
        var avio: UnsafeMutablePointer<AVIOContext>?
        /// input stream index -> output stream index, for the current muxer.
        var streamMap: [Int32: Int32] = [:]
        /// Muxer output accumulates here; the pipeline drains it into files at
        /// fragment boundaries. Per rendition, since each has its own muxer.
        var pending = Data()
        /// Segments this rendition has written. Guarded by the session lock.
        var completed = Set<Int>()
        /// First DTS written per output stream since the last muxer rebuild,
        /// in that stream's time base. The mov muxer normalizes every track's
        /// timeline to its first packet, so a generation restarted at 60s
        /// writes fragments claiming t=0; finishSegment() adds these back so
        /// tfdt really is absolute. Without this, a buffer mixing segments
        /// from two generations (early segments surviving the prune window, a
        /// seek regenerating later ones) jumps the playhead by the restart
        /// offset — found by the harness as decode positions +20s off on an
        /// Xvid AVI whose early segments escaped pruning.
        var baseDts: [Int32: Int64] = [:]

        /// Record the first DTS a stream writes in the current generation.
        func noteBaseDts(streamIndex: Int32, dts: Int64) {
            if baseDts[streamIndex] == nil, dts != Int64(bitPattern: 0x8000_0000_0000_0000) {
                baseDts[streamIndex] = dts
            }
        }

        init(prefix: String, inputStreams: [Int32], transcoder: AudioTranscoder?, videoTranscoder: VideoTranscoder? = nil) {
            self.prefix = prefix
            self.inputStreams = inputStreams
            self.transcoder = transcoder
            self.videoTranscoder = videoTranscoder
        }

        var initName: String { prefix.isEmpty ? "init.mp4" : "\(prefix)-init.mp4" }
        func segmentName(_ n: Int) -> String { prefix.isEmpty ? "seg\(n).m4s" : "\(prefix)-seg\(n).m4s" }

        /// Set when the muxer runs with delay_moov (Dolby passthrough), where the
        /// init segment does not exist until the first fragment is cut. Cleared
        /// by finishSegment() once it has written it.
        var awaitingDeferredInit = false

        func takePending() -> Data {
            let data = pending
            pending.removeAll(keepingCapacity: true)
            return data
        }

        /// Tear down just the muxer, keeping identity and bookkeeping.
        func freeMuxer() {
            if let avio {
                av_free(avio.pointee.buffer)
                var freeingIO: UnsafeMutablePointer<AVIOContext>? = avio
                avio_context_free(&freeingIO)
            }
            if let ctx { avformat_free_context(ctx) }
            avio = nil
            ctx = nil
            streamMap = [:]
            baseDts = [:]
        }
    }

    /// Build (or rebuild) the muxer for one rendition and write its init
    /// segment. Returns false on a fatal error.
    private func buildMuxer(for rendition: Rendition, input: UnsafeMutablePointer<AVFormatContext>) -> Bool {
        var outputCtx: UnsafeMutablePointer<AVFormatContext>? = nil
        var ret = avformat_alloc_output_context2(&outputCtx, nil, "mp4", nil)
        guard ret >= 0, let output = outputCtx else {
            fail("alloc_output: \(averr(ret))")
            return false
        }

        let ioBufSize = 1 << 16
        guard let ioBuf = av_malloc(ioBufSize) else {
            avformat_free_context(output)
            fail("av_malloc io buffer")
            return false
        }
        let opaque = Unmanaged.passUnretained(rendition).toOpaque()
        guard let avio = avio_alloc_context(
            ioBuf.assumingMemoryBound(to: UInt8.self), Int32(ioBufSize), 1, opaque, nil, Self.writeCallback, nil
        ) else {
            av_free(ioBuf)
            avformat_free_context(output)
            fail("avio_alloc_context")
            return false
        }
        output.pointee.pb = avio

        // Every failure path from here on must free what the two guards above already
        // handle inline: the muxer context, the custom AVIO context, and its buffer.
        // Ownership only transfers to the rendition at the very end (freeMuxer takes
        // over from there); until then this defer is the single cleanup path.
        var committed = false
        defer {
            if !committed {
                var freeingIO: UnsafeMutablePointer<AVIOContext>? = avio
                av_free(avio.pointee.buffer)
                avio_context_free(&freeingIO)
                avformat_free_context(output)
            }
        }

        var streamMap = [Int32: Int32]()
        for inIndex in rendition.inputStreams {
            guard let inStream = input.pointee.streams[Int(inIndex)],
                  let outStream = avformat_new_stream(output, nil) else {
                fail("avformat_new_stream")
                return false
            }

            // A transcoded track is described by its encoder, not the source:
            // AAC on the audio encoder's clock, H.264 on the video encoder's.
            let codecType = inStream.pointee.codecpar.pointee.codec_type
            if codecType == AVMEDIA_TYPE_AUDIO, let transcoder = rendition.transcoder, let encParams = transcoder.encoderParameters {
                ret = avcodec_parameters_copy(outStream.pointee.codecpar, encParams)
                guard ret >= 0 else {
                    fail("parameters_copy (encoder): \(averr(ret))")
                    return false
                }
                outStream.pointee.time_base = transcoder.encoderTimeBase
            } else if codecType == AVMEDIA_TYPE_VIDEO, let videoTranscoder = rendition.videoTranscoder, let encParams = videoTranscoder.encoderParameters {
                ret = avcodec_parameters_copy(outStream.pointee.codecpar, encParams)
                guard ret >= 0 else {
                    fail("parameters_copy (video encoder): \(averr(ret))")
                    return false
                }
                outStream.pointee.time_base = videoTranscoder.encoderTimeBase
            } else {
                ret = avcodec_parameters_copy(outStream.pointee.codecpar, inStream.pointee.codecpar)
                guard ret >= 0 else {
                    fail("parameters_copy: \(averr(ret))")
                    return false
                }
                outStream.pointee.time_base = inStream.pointee.time_base
            }
            // Default tag for everything except HEVC: FFmpeg's mp4 muxer
            // defaults HEVC to the 'hev1' sample entry, which AVFoundation
            // refuses in HLS — a bare -12927 on EVERY HEVC file through the
            // copy path (found by the HDR10 harness run; H.264 was fine
            // because the default there is 'avc1'). Apple requires 'hvc1'
            // (parameter sets in the sample entry), which is valid here
            // because demuxed MKV/MP4 sources always carry hvcC extradata.
            outStream.pointee.codecpar.pointee.codec_tag =
                outStream.pointee.codecpar.pointee.codec_id == AV_CODEC_ID_HEVC
                    ? (UInt32(UInt8(ascii: "h")) | UInt32(UInt8(ascii: "v")) << 8 | UInt32(UInt8(ascii: "c")) << 16 | UInt32(UInt8(ascii: "1")) << 24)
                    : 0
            streamMap[inIndex] = Int32(output.pointee.nb_streams - 1)
        }

        var muxOpts: OpaquePointer? = nil
        // One moof per segment holding a traf per track. Deliberately without
        // separate_moof (splits video and audio into two moof/mdat pairs) and
        // without dash (prepends per-track sidx boxes); both make AVFoundation
        // reject the segment in an HLS context. The styp box Apple requires is
        // prepended in finishSegment(), since the plain mp4 muxer never emits
        // one.
        //
        // delay_moov is set ONLY when this rendition copies Dolby through. AC-3
        // and E-AC-3 carry their configuration in a dac3/dec3 sample-entry box
        // built from bitstream fields the muxer cannot know until it has seen a
        // packet, so without the flag write_header fails outright with "Cannot
        // write moov atom before AC3 packets".
        //
        // With it, the moov is deferred and the box order shifts by one flush:
        // write_header emits nothing, the first cut emits ftyp+moov and no
        // media, and every cut after that is a clean moof+mdat. finishSegment()
        // handles that first cut. Measured against this exact FFmpeg build, not
        // assumed; an earlier note here claimed the flag folded the first
        // fragment into the moov as a bare mdat, which is what a single flush
        // looks like if you stop before the second one.
        //
        // Scoped to Dolby renditions on purpose. It is a muxer-wide flag, and
        // every other codec already writes a complete moov up front, so leaving
        // them alone keeps their init-segment timing exactly as it was.
        let carriesDolbyCopy =
            rendition.transcoder == nil
                && rendition.inputStreams.contains { index in
                    guard let stream = input.pointee.streams[Int(index)] else { return false }
                    let id = stream.pointee.codecpar.pointee.codec_id
                    return id == AV_CODEC_ID_AC3 || id == AV_CODEC_ID_EAC3
                }

        var movflags = "empty_moov+default_base_moof+frag_custom"
        if carriesDolbyCopy { movflags += "+delay_moov" }
        av_dict_set(&muxOpts, "movflags", movflags, 0)
        ret = avformat_write_header(output, &muxOpts)
        av_dict_free(&muxOpts)
        guard ret >= 0 else {
            fail("write_header: \(averr(ret))")
            return false
        }

        avio_flush(avio)
        if carriesDolbyCopy {
            // Nothing was emitted; the init segment arrives at the first cut.
            rendition.awaitingDeferredInit = true
            _ = rendition.takePending()
        } else {
            // Bytes emitted by write_header (ftyp + empty moov) are the init
            // segment. Identical every generation, so overwriting is harmless.
            do {
                try rendition.takePending().write(to: dir.appendingPathComponent(rendition.initName))
            } catch {
                fail("write \(rendition.initName): \(error.localizedDescription)")
                return false
            }
        }

        rendition.ctx = output
        rendition.avio = avio
        rendition.streamMap = streamMap
        committed = true
        return true
    }

    /// Publish what the engine decided for every stream, once the renditions
    /// exist and before a single packet moves. Goes to the device console and,
    /// through `onPlan`, to JS — which is the only channel that reaches a
    /// physical Apple TV.
    ///
    /// Deliberately built from the live objects rather than from the same
    /// conditions restated: `action` is "copy" exactly when the rendition holds
    /// no transcoder, so the report cannot claim a copy the pipeline is not
    /// doing.
    ///
    /// Called again after every seek-restart, because `restart(at:)` rebuilds
    /// each rendition's transcoders from scratch and a rebuild could in
    /// principle open a different encoder than the first attempt did (the
    /// candidate ladder tries FLAC before AAC and takes whichever opens). A
    /// stale plan would be worse than no plan, since the suite asserts against
    /// it. Identical plans are dropped rather than re-emitted, so a normal seek
    /// costs nothing and a genuine change is impossible to miss.
    private func reportPlan(
        input: UnsafeMutablePointer<AVFormatContext>,
        videoIn: Int32,
        audioIndices: [Int32],
        renditions: [Rendition]
    ) {
        // Read the video transcoder off the renditions rather than taking it as
        // an argument: after a restart the caller's copy is the pre-seek object,
        // and reporting that would defeat the point of reporting at all.
        let videoTranscoder = renditions.first { $0.videoTranscoder != nil }?.videoTranscoder

        var video: [String: Any] = ["streamIndex": Int(videoIn)]
        if let stream = input.pointee.streams[Int(videoIn)] {
            video["source"] = EnginePlan.describe(stream.pointee.codecpar)
        }
        if let encoded = videoTranscoder?.encoderParameters {
            video["action"] = "encode"
            video["output"] = EnginePlan.describe(encoded)
        } else {
            video["action"] = "copy"
        }

        var audio: [[String: Any]] = []
        for index in audioIndices {
            guard let stream = input.pointee.streams[Int(index)] else { continue }
            let rendition = renditions.first { $0.inputStreams.contains(index) }
            var entry: [String: Any] = [
                "streamIndex": Int(index),
                "rendition": (rendition?.prefix).flatMap { $0.isEmpty ? nil : $0 } ?? "primary",
                "source": EnginePlan.describe(stream.pointee.codecpar),
            ]
            if let transcoder = rendition?.transcoder, let encoded = transcoder.encoderParameters {
                entry["action"] = "encode"
                entry["encoder"] = transcoder.encoderName
                entry["output"] = EnginePlan.describe(encoded)
            } else {
                entry["action"] = "copy"
            }
            audio.append(entry)
        }

        // One line per stream, keyed on what the report actually claims, so an
        // unchanged plan after a seek is silent and a changed one is loud.
        let signature = ([EnginePlan.summary(video)] + audio.map { entry in
            "\(entry["streamIndex"] as? Int ?? -1):\(entry["encoder"] as? String ?? "-"):\(EnginePlan.summary(entry))"
        }).joined(separator: "|")
        if signature == lastPlanSignature { return }
        let isRevision = lastPlanSignature != nil
        lastPlanSignature = signature

        if isRevision {
            NSLog("[LocalRemuxer] plan CHANGED after restart, re-reporting")
        }
        NSLog("[LocalRemuxer] plan video: %@", EnginePlan.summary(video))
        for entry in audio {
            NSLog("[LocalRemuxer] plan audio %d: %@", entry["streamIndex"] as? Int ?? -1, EnginePlan.summary(entry))
        }

        onPlan?(["token": token, "video": video, "audio": audio])
    }

    private func runPipeline() {
        let opaque = Unmanaged.passUnretained(self).toOpaque()

        // ---- Input: opened once; seeks reuse the same context ----
        var inputCtx: UnsafeMutablePointer<AVFormatContext>? = avformat_alloc_context()
        guard inputCtx != nil else { return fail("avformat_alloc_context") }
        inputCtx!.pointee.interrupt_callback = AVIOInterruptCB(callback: Self.interruptCallback, opaque: opaque)

        var openOpts: OpaquePointer? = nil
        av_dict_set(&openOpts, "reconnect", "1", 0)
        av_dict_set(&openOpts, "reconnect_streamed", "1", 0)
        av_dict_set(&openOpts, "reconnect_delay_max", "5", 0)
        // A silently wedged read (TCP stall with no RST) otherwise blocks
        // av_read_frame forever: the interrupt callback only fires on session
        // cancel, `failed` never gets set, and every segment request starves
        // out its 20s deadline with the producer looking alive. 15s per I/O
        // operation turns the stall into an error the reconnect options above
        // can retry, or a clean fail() the player recovers from.
        av_dict_set(&openOpts, "rw_timeout", "15000000", 0)
        var ret = avformat_open_input(&inputCtx, config.inputUrl, nil, &openOpts)
        av_dict_free(&openOpts)
        guard ret >= 0, let input = inputCtx else { return fail("open_input: \(averr(ret))") }
        defer {
            var closing: UnsafeMutablePointer<AVFormatContext>? = input
            avformat_close_input(&closing)
        }

        ret = avformat_find_stream_info(input, nil)
        guard ret >= 0 else { return fail("find_stream_info: \(averr(ret))") }

        let videoIn = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        guard videoIn >= 0 else { return fail("no video stream") }

        // Resolve the audio tracks to carry, in the order the playlist will
        // advertise them. Several tracks: each becomes an audio-only rendition
        // ("a0", "a1", …) and the variant is video-only — see masterPlaylist()
        // for why (picker labels). A lone track is muxed with the video.
        let streamCount = Int32(input.pointee.nb_streams)
        var audioIndices: [Int32] = config.audioTracks
            .map { Int32($0.index) }
            .filter { $0 >= 0 && $0 < streamCount && input.pointee.streams[Int($0)]?.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_AUDIO }
        if audioIndices.isEmpty {
            let best = av_find_best_stream(input, AVMEDIA_TYPE_AUDIO, -1, videoIn, nil, 0)
            if best >= 0 { audioIndices = [best] }
        }

        // Image subtitle tracks (PGS, DVD/VobSub, DVB, XSUB): one decoder each,
        // fed from the read loop below. The packets are demuxed either way — the
        // loop drops any stream no rendition claims — so this adds decode and
        // PNG encoding but not a single extra byte off the network. Their canvas
        // falls back to the video's dimensions, since most files leave it unset
        // in codecpar and only the decoder learns the real one.
        let videoParams = input.pointee.streams[Int(videoIn)]?.pointee.codecpar
        let fallbackWidth = Int(videoParams?.pointee.width ?? 0)
        let fallbackHeight = Int(videoParams?.pointee.height ?? 0)
        for sub in config.subtitles where sub.isImage {
            let index = Int32(sub.index)
            guard index >= 0, index < streamCount, let stream = input.pointee.streams[Int(index)] else { continue }
            guard let decoder = ImageSubtitleDecoder(
                stream: stream,
                fallbackWidth: fallbackWidth,
                fallbackHeight: fallbackHeight,
                dir: dir
            ) else { continue }
            stateLock.lock()
            imageSubtitles[index] = decoder
            stateLock.unlock()
        }
        if !imageSubtitles.isEmpty {
            NSLog("[LocalRemuxer] harvesting %d image subtitle track(s)", imageSubtitles.count)
        }

        // Audio AVPlayer can't decode (AC3, DTS, TrueHD, Opus, Vorbis) is
        // re-encoded on the way through, losslessly where the encoder allows;
        // AAC, ALAC and well-formed FLAC copy untouched. Video is always copied.
        // Transcoders are built before the muxers, which describe the output
        // track from the encoder.
        func makeTranscoder(for streamIndex: Int32) -> AudioTranscoder?? {
            guard let audioStream = input.pointee.streams[Int(streamIndex)] else { return .some(nil) }
            guard AudioTranscoder.needsTranscode(stream: audioStream) else { return .some(nil) }
            guard let transcoder = AudioTranscoder(inputStream: audioStream) else {
                return nil // unrecoverable
            }
            return .some(transcoder)
        }

        // Video AVPlayer cannot decode is re-encoded to H.264 through
        // VideoToolbox; H.264/HEVC (and hardware-gated AV1) keep copying.
        // Built before the muxers, which describe the output track from the
        // encoder. A nil here (interlaced, wrong pixel format, no encoder)
        // fails the session cleanly and the player falls back to the server.
        let videoCodecId = input.pointee.streams[Int(videoIn)]!.pointee.codecpar.pointee.codec_id
        var primaryVideoTranscoder: VideoTranscoder? = nil
        if VideoTranscoder.needsTranscode(codecId: videoCodecId) {
            guard let stream = input.pointee.streams[Int(videoIn)],
                  let transcoder = VideoTranscoder(inputStream: stream) else {
                return fail("no H.264 transcode path for video codec \(videoCodecId.rawValue)")
            }
            NSLog("[LocalRemuxer] Transcoding video stream %d to H.264 via VideoToolbox", videoIn)
            primaryVideoTranscoder = transcoder
        }

        var builtRenditions: [Rendition] = []
        if audioIndices.count > 1 {
            builtRenditions.append(Rendition(prefix: "", inputStreams: [videoIn], transcoder: nil, videoTranscoder: primaryVideoTranscoder))
        }
        for (position, audioIndex) in audioIndices.enumerated() {
            guard let transcoder = makeTranscoder(for: audioIndex) else {
                return fail("no transcode path for audio stream \(audioIndex)")
            }
            if audioIndices.count > 1 {
                builtRenditions.append(Rendition(prefix: audioPrefix(position), inputStreams: [audioIndex], transcoder: transcoder, videoTranscoder: nil))
            } else {
                builtRenditions.append(Rendition(prefix: "", inputStreams: [videoIn, audioIndex], transcoder: transcoder, videoTranscoder: primaryVideoTranscoder))
            }
        }
        if builtRenditions.isEmpty {
            // Video with no audio at all.
            builtRenditions = [Rendition(prefix: "", inputStreams: [videoIn], transcoder: nil, videoTranscoder: primaryVideoTranscoder)]
        }

        stateLock.lock()
        renditions = builtRenditions
        stateLock.unlock()
        defer { builtRenditions.forEach { $0.freeMuxer() } }

        reportPlan(input: input, videoIn: videoIn, audioIndices: audioIndices, renditions: builtRenditions)

        let microTb = AVRational(num: 1, den: SWIFT_AV_TIME_BASE)
        let segDur = Self.segmentDuration

        for rendition in builtRenditions {
            guard buildMuxer(for: rendition, input: input) else { return }
        }

        var packet = av_packet_alloc()
        defer { av_packet_free(&packet) }
        guard let pkt = packet else { return fail("av_packet_alloc") }

        var currentSegment = 0
        // Every generation, including the first, opens on a video keyframe.
        // Starting mid-GOP would feed the muxer leading B-frames whose DTS runs
        // behind the anchor and can arrive out of order, which it rejects.
        var awaitingKeyframe = true
        // Transcode path: which segment already had its boundary IDR
        // requested, so a run of input frames past the boundary doesn't force
        // one keyframe per frame while the encoder catches up.
        var keyframeForcedAtSegment = -1

        // Timeline anchor, in AV_TIME_BASE units: `outputPts = inputPts - anchor`.
        // Fixed ONCE, by the first keyframe generation 0 muxes, and reused
        // unchanged by every seek-restart, so output time equals source media
        // time for the whole session.
        //
        // This used to be re-derived per generation as `keyframe - segment*6`,
        // which relabelled whatever keyframe a seek landed on as if it sat
        // exactly on the requested segment boundary. Since the seek runs
        // BACKWARD, that keyframe is at or before the boundary, so the entire
        // media timeline shifted later by the gap (up to a full GOP). Audio and
        // video shifted together and stayed in sync with each other, but the
        // WebVTT rendition carries absolute source times and is never rebased,
        // so subtitles ran ahead of the picture by that gap after every seek,
        // and the reported position stopped matching the content on screen.
        //
        // Deliberately not the container's `start_time`, which need not line up
        // with the first packet and produced negative, non-monotonic DTS on
        // files with B-frames.
        var sessionAnchorUs: Int64? = nil
        var timelineAnchorUs: Int64 = 0

        // Segment this generation was restarted for. The generation opens on
        // the keyframe at or before it, which can belong to an earlier segment.
        var generationRequestSegment = 0
        // The generation's opening segment when its keyframe sits past that
        // segment's nominal start, so the segment is short at the head and must
        // not be published; -1 when the opening segment is whole.
        var partialOpenSegment = -1

        /// Close segment `n` on every rendition. All renditions are cut on the
        /// same boundary so their timelines stay interchangeable, which is what
        /// lets AVPlayer swap audio renditions mid-playback.
        func finishSegment(_ n: Int) {
            for rendition in builtRenditions {
                guard let ctx = rendition.ctx, let avio = rendition.avio else { continue }
                av_write_frame(ctx, nil) // flush the open fragment
                avio_flush(avio)
                var data = rendition.takePending()

                // Dolby passthrough (delay_moov): this first cut carried the
                // deferred ftyp+moov and no media at all. Publish it as the init
                // segment, then cut again so this segment gets its own fragment.
                // Without the second cut the packets written so far would merge
                // into the NEXT segment and every boundary would slip by one.
                if rendition.awaitingDeferredInit {
                    do {
                        try data.write(to: dir.appendingPathComponent(rendition.initName))
                    } catch {
                        return fail("write \(rendition.initName): \(error.localizedDescription)")
                    }
                    rendition.awaitingDeferredInit = false
                    av_write_frame(ctx, nil)
                    avio_flush(avio)
                    data = rendition.takePending()
                }

                // Never publish the generation's opening segment when its
                // keyframe landed past that segment's start: the fragment is
                // short at the head. Flushing it above keeps the next one
                // clean; discarding it here means a later request for this
                // index restarts at its own boundary, which necessarily seeks
                // to an earlier keyframe and covers the segment in full.
                if n == partialOpenSegment { continue }
                guard !data.isEmpty else { continue }

                // The header already shipped ftyp+moov as the init segment, so
                // a media segment should start at its moof. Guard anyway: a
                // muxer that ever prefixes header boxes here would bake them
                // into the segment, which AVFoundation rejects with a bare
                // -12889.
                guard let fragmentStart = Self.firstFragmentOffset(in: data) else {
                    return fail("segment \(n) (\(rendition.prefix.isEmpty ? "primary" : rendition.prefix)) contains no moof box")
                }
                if fragmentStart > 0 {
                    data = data.subdata(in: fragmentStart..<data.count)
                }

                // tfdt back to absolute (track_id is 1-based in stream order).
                var offsets: [UInt32: Int64] = [:]
                for (_, outIndex) in rendition.streamMap {
                    if let base = rendition.baseDts[outIndex], base != 0 {
                        offsets[UInt32(outIndex) + 1] = base
                    }
                }
                var segment = Self.stypBox + data
                if !offsets.isEmpty {
                    Self.patchTfdtToAbsolute(in: &segment, offsets: offsets)
                }

                do {
                    try segment.write(to: dir.appendingPathComponent(rendition.segmentName(n)))
                } catch {
                    return fail("write \(rendition.segmentName(n)): \(error.localizedDescription)")
                }
                stateLock.lock()
                rendition.completed.insert(n)
                stateLock.unlock()
            }

            stateLock.lock()
            let playhead = lastRequestedSegment
            stateLock.unlock()
            pruneSegments(outside: (playhead - Self.keepWindow)...(playhead + Self.keepWindow))
        }

        /// Seek input + rebuild every rendition's muxer. False on fatal error.
        func restart(at segment: Int) -> Bool {
            let restartStart = Date()
            let containerStartUs = input.pointee.start_time == SWIFT_AV_NOPTS_VALUE ? 0 : input.pointee.start_time
            let targetUs = Int64(Double(segment) * segDur * Double(SWIFT_AV_TIME_BASE)) + containerStartUs
            let seekRet = avformat_seek_file(input, -1, Int64.min, targetUs, targetUs, SWIFT_AVSEEK_FLAG_BACKWARD)
            if seekRet < 0 {
                // A session that cannot seek must die, not limp: continuing
                // from the current position would stamp whatever content comes
                // next with the requested segment's timestamps (or hang the
                // request entirely, as a VP6 AVI with a defective index did in
                // the harness). Failing here answers the player in
                // milliseconds and the app falls back to the server transcode.
                fail("input seek to segment \(segment) failed: \(averr(seekRet))")
                return false
            }

            for rendition in builtRenditions {
                rendition.freeMuxer()
                _ = rendition.takePending() // drop bytes of the abandoned fragment

                // Rebuild the audio transcoder rather than reusing it: AAC
                // encoders cannot be flushed, so a reused one would emit queued
                // frames still carrying pre-seek timestamps and the muxer would
                // reject them as non-monotonic. A fresh one seeds its sample
                // clock from the first packet it is handed, keeping audio
                // aligned with video wherever the generation opens.
                if rendition.transcoder != nil {
                    guard let audioIndex = rendition.inputStreams.first(where: {
                        input.pointee.streams[Int($0)]?.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_AUDIO
                    }), let rebuilt = makeTranscoder(for: audioIndex), rebuilt != nil else {
                        fail("failed to rebuild audio transcoder after seek")
                        return false
                    }
                    rendition.transcoder = rebuilt
                }

                // Same rule for video: a flushed VideoToolbox session is done,
                // and a reused one would emit frames carrying pre-seek
                // timestamps. Identical settings produce identical SPS/PPS, so
                // the rewritten init segment stays byte-stable (asserted by
                // the harness, since AVPlayer caches init segments).
                if rendition.videoTranscoder != nil {
                    guard let stream = input.pointee.streams[Int(videoIn)],
                          let rebuilt = VideoTranscoder(inputStream: stream) else {
                        fail("failed to rebuild video transcoder after seek")
                        return false
                    }
                    rendition.videoTranscoder = rebuilt
                }

                guard buildMuxer(for: rendition, input: input) else { return false }
            }

            // Subtitle decoders survive the seek — their events are in source
            // time and everything already harvested stays valid — but their
            // internal state must not: a half-received PGS display set would
            // otherwise merge with packets from the new position. Events already
            // recorded are recognised on the way past and not duplicated.
            //
            // They are also told how far the read actually got, so a display set
            // still on screen is closed there rather than being carried across
            // the region this seek skips.
            for decoder in imageSubtitles.values { decoder.flush(demuxedUpTo: demuxedUpTo) }

            // The transcoders above were rebuilt from scratch; re-derive the
            // plan so a rebuild that reached a different decision cannot leave
            // JS (and the regression suite) asserting against a stale claim.
            // No-ops when the decisions are unchanged, which is the normal case.
            reportPlan(input: input, videoIn: videoIn, audioIndices: audioIndices, renditions: builtRenditions)

            // Provisional: the keyframe block below moves currentSegment back
            // to wherever the seek actually landed. producingSegment keeps
            // reporting the REQUESTED segment while the generation catches up
            // to it, so a waiter on that segment neither re-asserts its seek
            // (the control block drops a seek equal to producingSegment) nor
            // throttles the producer that is filling it.
            currentSegment = segment
            generationRequestSegment = segment
            partialOpenSegment = -1
            awaitingKeyframe = true
            keyframeForcedAtSegment = -1
            stateLock.lock()
            producingSegment = segment
            reachedEnd = false
            stateLock.unlock()
            NSLog("[LocalRemuxer] Seek-restart at segment %d took %.2fs", segment, Date().timeIntervalSince(restartStart))
            return true
        }

        readLoop: while true {
            // Session control between packets: cancellation, seeks, throttle.
            while true {
                stateLock.lock()
                let stop = cancelled || failed
                var seekTo = pendingSeekSegment
                pendingSeekSegment = nil
                // Drop a seek the pipeline already answered: a waiter's
                // re-assert can race the restart that is serving it, and
                // restarting again would tear the muxers down for nothing.
                if let target = seekTo,
                   target == producingSegment || (renditions.first?.completed.contains(target) ?? false) {
                    seekTo = nil
                }
                // Never sleep while a request waits on a segment inside the
                // production window: lastRequestedSegment is overwritten by
                // every request (including ones served instantly from disk),
                // so on its own it can park the producer while a live request
                // just ahead of it starves to the 20s deadline.
                let starvedWaiter = activeWaiters.keys.contains {
                    $0 >= producingSegment && $0 <= producingSegment + Self.aheadWindow
                }
                let throttled = producingSegment > lastRequestedSegment + Self.aheadWindow && seekTo == nil && !stop && !starvedWaiter
                stateLock.unlock()

                if stop { break readLoop }
                if let seekTo {
                    guard restart(at: seekTo) else { break readLoop }
                    break
                }
                if !throttled { break }
                usleep(100_000)
            }

            ret = av_read_frame(input, pkt)
            if ret == SWIFT_AVERROR_EOF {
                // Flush the transcoders first so their queued tail frames land
                // in the final segment instead of being dropped with it.
                for rendition in builtRenditions {
                    guard let ctx = rendition.ctx else { continue }
                    func writeFlushed(_ timeBase: AVRational, _ outIndex: Int32) -> (UnsafeMutablePointer<AVPacket>) -> Void {
                        return { encoded in
                            guard let outStream = ctx.pointee.streams[Int(outIndex)] else { return }
                            av_packet_rescale_ts(encoded, timeBase, outStream.pointee.time_base)
                            encoded.pointee.stream_index = outIndex
                            encoded.pointee.pos = -1
                            rendition.noteBaseDts(streamIndex: outIndex, dts: encoded.pointee.dts)
                            _ = av_write_frame(ctx, encoded)
                        }
                    }
                    if let videoTranscoder = rendition.videoTranscoder, let outIndex = rendition.streamMap[videoIn] {
                        videoTranscoder.process(packet: nil, emit: writeFlushed(videoTranscoder.encoderTimeBase, outIndex))
                    }
                    if let transcoder = rendition.transcoder,
                       let audioIn = rendition.inputStreams.first(where: {
                           input.pointee.streams[Int($0)]?.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_AUDIO
                       }),
                       let outIndex = rendition.streamMap[audioIn] {
                        transcoder.process(packet: nil, emit: writeFlushed(transcoder.encoderTimeBase, outIndex))
                    }
                }

                // Close whatever subtitle is still on screen at EOF, so the last
                // cue of the file has a real end rather than an open one.
                for decoder in imageSubtitles.values { decoder.finish(at: config.durationSeconds) }

                finishSegment(currentSegment)
                for rendition in builtRenditions {
                    guard let ctx = rendition.ctx, let avio = rendition.avio else { continue }
                    av_write_trailer(ctx)
                    avio_flush(avio)
                    _ = rendition.takePending() // trailer bytes (mfra) are not a segment
                }

                // Reaching the end must NOT end the session: the viewer can
                // still seek backwards, and this thread is the only producer.
                // Park until a seek arrives (or the session is torn down)
                // instead of returning, and record how far the real stream
                // actually got so requests past it fail fast rather than
                // waiting out the full segment timeout.
                stateLock.lock()
                reachedEnd = true
                lastProducedSegment = currentSegment
                stateLock.unlock()

                var resume = false
                while !resume {
                    stateLock.lock()
                    let stop = cancelled || failed
                    let pending = pendingSeekSegment
                    stateLock.unlock()
                    if stop { break readLoop }
                    if pending != nil {
                        // Leave it queued; the control block at the top of the
                        // loop performs the restart.
                        resume = true
                        break
                    }
                    usleep(200_000)
                }
                continue
            }
            if ret == SWIFT_AVERROR_EXIT { break }
            if ret < 0 {
                fail("read_frame: \(averr(ret))")
                break
            }
            defer { av_packet_unref(pkt) }

            // How far the source has actually been read: the subtitle decoders'
            // "we stopped knowing here" marker on the next seek, and what the
            // app polls to decide it has enough manifest to stop asking.
            //
            // Under the lock because the HTTP queue reads it now
            // (subtitleCueManifest), and only for files that carry image
            // subtitles, which is the only reason it is tracked at all.
            if !imageSubtitles.isEmpty, pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE,
               let packetStream = input.pointee.streams[Int(pkt.pointee.stream_index)] {
                let seconds = Double(pkt.pointee.pts) * av_q2d(packetStream.pointee.time_base)
                stateLock.lock()
                if seconds > demuxedUpTo { demuxedUpTo = seconds }
                stateLock.unlock()
            }

            // Image subtitles are harvested here, before the routing guard
            // below drops them. They never enter a rendition — AVPlayer cannot
            // decode a bitmap subtitle — so they are decoded to PNGs and a
            // display-set manifest the app draws itself. This runs regardless of
            // the keyframe gate: an event's time comes from its own PTS in
            // source time, so it does not care which generation of the output
            // timeline is being produced.
            if let subtitleDecoder = imageSubtitles[pkt.pointee.stream_index] {
                subtitleDecoder.handle(packet: pkt)
                continue
            }

            // Route to the rendition carrying this input stream. A stream no
            // rendition wants (an unselected audio track, subtitles) is simply
            // dropped.
            guard let rendition = builtRenditions.first(where: { $0.streamMap[pkt.pointee.stream_index] != nil }),
                  let outIndex = rendition.streamMap[pkt.pointee.stream_index],
                  let ctx = rendition.ctx,
                  let inStream = input.pointee.streams[Int(pkt.pointee.stream_index)],
                  let outStream = ctx.pointee.streams[Int(outIndex)] else { continue }

            let isVideo = pkt.pointee.stream_index == videoIn
            let isKey = pkt.pointee.flags & SWIFT_AV_PKT_FLAG_KEY != 0

            // Drop everything until the video keyframe that opens this
            // generation, then place it on the session timeline. The anchor is
            // whatever generation 0 established and never moves, so the
            // keyframe keeps its true source time instead of being relabelled
            // onto the requested segment's boundary.
            if awaitingKeyframe {
                if !(isVideo && isKey) { continue }
                let anchorSource = pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE ? pkt.pointee.pts : pkt.pointee.dts
                guard anchorSource != SWIFT_AV_NOPTS_VALUE else { continue }
                let keyframeUs = av_rescale_q(anchorSource, inStream.pointee.time_base, microTb)
                let anchor = sessionAnchorUs ?? keyframeUs
                sessionAnchorUs = anchor
                timelineAnchorUs = anchor

                // The generation opens where the keyframe actually is, not
                // where the request was. avformat_seek_file ran BACKWARD
                // bounded by the requested segment's start, so this is at or
                // before it and that segment still ends up fully covered.
                let openSeconds = Double(keyframeUs - anchor) / Double(SWIFT_AV_TIME_BASE)
                let openSegment = max(0, Int(openSeconds / segDur))
                if openSegment > generationRequestSegment {
                    // Only reachable through a defective index that seeks past
                    // the target. Producing from here would stamp the wrong
                    // content with the requested segment's timestamps, so die
                    // fast and let the app fall back to the server transcode,
                    // exactly as a failed seek does.
                    fail("seek for segment \(generationRequestSegment) landed in segment \(openSegment)")
                    break
                }
                currentSegment = openSegment
                partialOpenSegment = openSeconds > Double(openSegment) * segDur ? openSegment : -1
                awaitingKeyframe = false
            }

            // Rebase onto the output timeline.
            let offsetInTb = av_rescale_q(timelineAnchorUs, microTb, inStream.pointee.time_base)
            if pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE { pkt.pointee.pts -= offsetInTb }
            if pkt.pointee.dts != SWIFT_AV_NOPTS_VALUE { pkt.pointee.dts -= offsetInTb }

            // Video through the transcoder: decode → VideoToolbox H.264.
            // Segment boundaries are cut on ENCODED packets — the encoder
            // runs a few frames behind the input, so cutting on input PTS
            // would put the wrong frames in the fragment — while the IDR
            // request rides the INPUT frame that crosses the boundary, so the
            // keyframe lands on the segment's first frame. Input packets are
            // never dropped for negative DTS here: the decoder needs them,
            // and VideoTranscoder drops pre-anchor frames itself.
            if isVideo, let videoTranscoder = rendition.videoTranscoder {
                if pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE, keyframeForcedAtSegment != currentSegment {
                    let seconds = Double(pkt.pointee.pts) * av_q2d(inStream.pointee.time_base)
                    if seconds >= Double(currentSegment + 1) * segDur {
                        videoTranscoder.forceKeyframeNext()
                        keyframeForcedAtSegment = currentSegment
                    }
                }

                var writeError: Int32 = 0
                videoTranscoder.process(packet: pkt) { encoded in
                    guard writeError == 0 else { return }
                    if encoded.pointee.pts != SWIFT_AV_NOPTS_VALUE {
                        let seconds = Double(encoded.pointee.pts) * av_q2d(videoTranscoder.encoderTimeBase)
                        let boundary = Double(currentSegment + 1) * segDur
                        if seconds >= boundary && seconds > 0 && currentSegment + 1 < segmentCount {
                            finishSegment(currentSegment)
                            currentSegment += 1
                            stateLock.lock()
                            // Floored at the requested segment: a generation
                            // that opened on an earlier keyframe must not
                            // advertise a position behind what it was asked
                            // for, or the waiter on that segment would keep
                            // re-asserting its seek and restart the pipeline
                            // onto the same keyframe forever.
                            producingSegment = max(currentSegment, generationRequestSegment)
                            stateLock.unlock()
                        }
                    }
                    av_packet_rescale_ts(encoded, videoTranscoder.encoderTimeBase, outStream.pointee.time_base)
                    encoded.pointee.stream_index = outIndex
                    encoded.pointee.pos = -1
                    rendition.noteBaseDts(streamIndex: outIndex, dts: encoded.pointee.dts)
                    let w = av_write_frame(ctx, encoded)
                    if w < 0 { writeError = w }
                }
                if videoTranscoder.failed {
                    fail("video transcode failed (pixel format or encoder rejection)")
                    break
                }
                if writeError < 0 {
                    fail("write_frame (video): \(averr(writeError))")
                    break
                }
                continue
            }

            // Drop anything landing before the output timeline's zero. Video:
            // a leading B-frame can carry a DTS just behind the anchor — it
            // belongs to the previous GOP and would break the muxer's
            // monotonic-DTS requirement. Copied audio: the first packet of an
            // AAC-in-MKV stream is the encoder's priming frame at a NEGATIVE
            // timestamp; fed raw to the mp4 muxer, its per-track shift
            // desyncs the track and stamps a bogus first-sample duration that
            // CoreMedia's HLS validator rejects wholesale (-12927 on HEVC
            // files, found by the HDR10 harness run — ffmpeg's CLI avoids it
            // by globally shifting all input timestamps instead).
            if pkt.pointee.dts != SWIFT_AV_NOPTS_VALUE, pkt.pointee.dts < 0 { continue }

            // Segment boundary: close the fragment on the first video packet
            // at or past the next segment's start time.
            //
            // Deliberately NOT keyframe-gated. Files whose keyframes are
            // sparser than the segment length (a 10s GOP against 6s segments)
            // would otherwise skip whole segment indices, and every skipped
            // index is a hard 404 for a segment the playlist promises. Closing
            // on the boundary and advancing exactly one segment guarantees
            // every declared index gets written. Seeks still land on a
            // keyframe, because a seek-restart re-anchors there.
            if isVideo && pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE {
                let seconds = Double(pkt.pointee.pts) * av_q2d(inStream.pointee.time_base)
                let boundary = Double(currentSegment + 1) * segDur
                if seconds >= boundary && seconds > 0 && currentSegment + 1 < segmentCount {
                    finishSegment(currentSegment)
                    currentSegment += 1
                    stateLock.lock()
                    // Floored at the requested segment, same reason as the
                    // transcode path above.
                    producingSegment = max(currentSegment, generationRequestSegment)
                    stateLock.unlock()
                }
            }

            // Transcoded audio: the encoder emits its own packets on its own
            // clock, so the input packet is consumed rather than written.
            if !isVideo, let transcoder = rendition.transcoder {
                var writeError: Int32 = 0
                transcoder.process(packet: pkt) { encoded in
                    guard writeError == 0 else { return }
                    av_packet_rescale_ts(encoded, transcoder.encoderTimeBase, outStream.pointee.time_base)
                    encoded.pointee.stream_index = outIndex
                    encoded.pointee.pos = -1
                    rendition.noteBaseDts(streamIndex: outIndex, dts: encoded.pointee.dts)
                    let w = av_write_frame(ctx, encoded)
                    if w < 0 { writeError = w }
                }
                if writeError < 0 {
                    fail("write_frame (audio): \(averr(writeError))")
                    break
                }
                continue
            }

            av_packet_rescale_ts(pkt, inStream.pointee.time_base, outStream.pointee.time_base)
            pkt.pointee.stream_index = outIndex
            pkt.pointee.pos = -1
            rendition.noteBaseDts(streamIndex: outIndex, dts: pkt.pointee.dts)

            ret = av_write_frame(ctx, pkt)
            if ret < 0 {
                fail("write_frame: \(averr(ret))")
                break
            }
        }
    }

    /// Drop segments that sit outside the window around the playhead, across
    /// every rendition.
    private func pruneSegments(outside keep: ClosedRange<Int>) {
        stateLock.lock()
        var doomed: [(Rendition, [Int])] = []
        for rendition in renditions {
            let prunable = rendition.completed.filter { !keep.contains($0) }
            guard !prunable.isEmpty else { continue }
            rendition.completed.subtract(prunable)
            doomed.append((rendition, Array(prunable)))
        }
        stateLock.unlock()

        for (rendition, indices) in doomed {
            for n in indices {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent(rendition.segmentName(n)))
            }
        }
    }
}
