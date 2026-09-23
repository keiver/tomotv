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
//  The FFmpeg build ships no hls/segment muxer, so segmentation is done here:
//  the mp4 muxer
//  runs with frag_custom into a custom write callback, and every explicit
//  fragment flush closes one .m4s file.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

// FFmpeg's error/constant macros don't survive the Clang importer.
let SWIFT_AV_PKT_FLAG_KEY: Int32 = 0x0001

/// find_stream_info with every decoder told to skip non-key frames. A stream joined mid-GOP
/// (a tuner, a tuner recording) then costs one slice-header line instead of one per packet, and
/// the parameters still come from the first keyframe, where they always came from.
func probeStreamInfo(_ ctx: UnsafeMutablePointer<AVFormatContext>) -> Int32 {
    let count = Int(ctx.pointee.nb_streams)
    var options = [OpaquePointer?](repeating: nil, count: max(count, 1))
    for i in 0..<count { av_dict_set(&options[i], "skip_frame", "nokey", 0) }
    let ret = avformat_find_stream_info(ctx, &options)
    for i in 0..<count { av_dict_free(&options[i]) }
    return ret
}

/// A single remux session: FFmpeg pipeline + segment store + playlist model.
/// One session exists at a time (mirrors MultiAudioResourceLoader's model).
final class RemuxSession {
    static let segmentDuration = 6.0

    /// A WebVTT segment's wait for the read loop. Matches the video segment's,
    /// and giving up early loses those cues: a VOD segment is fetched once.
    static let subtitleSegmentWaitSeconds = 25.0
    /// Produce-ahead depth when the config carries none.
    static let defaultAheadWindow = 5
    /// How far ahead of the producer a request may land and still be waited for; past it, a seek.
    static let seekAheadSegments = 2
    /// Keep producing this many segments past the one AVPlayer last asked for,
    /// then idle. Bounds eager download of the source; the JS side passes a
    /// deeper cushion so a stalling remote feed can be absorbed.
    let aheadWindow: Int
    /// Half-width of the on-disk window kept around the playhead. Segments
    /// outside it are deleted; the producer can always regenerate them with a
    /// seek-restart, so this only bounds disk use. Must stay >= aheadWindow or
    /// the pruner deletes fresh segments before they are ever served.
    let keepWindow: Int
    /// Live: segments listed and kept on disk, under stateLock. A hot neighbour starts short and
    /// widens when a player adopts it.
    var liveKeepSegments: Int

    let token = UUID().uuidString
    let config: RemuxConfig
    let dir: URL
    var sourceBandwidth: Int { config.sourceBandwidth > 0 ? config.sourceBandwidth : config.bandwidth }

    let stateLock = NSLock()
    /// Chapter keyframes for the tvOS info panel, from a context of their own; the
    /// pipeline never sees them. Built on the first request, under the lock.
    var frameGrabber: FrameGrabber?
    let poolEpoch = ChapterFramePool.epoch
    /// Primary rendition first, then one per alternate audio track. Built on
    /// the pipeline thread before production starts; the serving side reads it
    /// under the lock.
    var renditions: [Rendition] = []
    var renditionBitrates: [String: SegmentBitrates] = [:]
    var indexedSourcePeak: Int?
    var producingSegment = 0
    /// The segment AVPlayer asked for most recently — the playhead. Note this
    /// is NOT a high-water mark: after seeking backwards it must move back, or
    /// the producer would stay throttled and freshly written segments would be
    /// pruned the instant they landed.
    var lastRequestedSegment = 0
    /// Set once the input hits EOF. `lastProducedSegment` is then the highest
    /// segment the real stream actually yielded, which can be below the last
    /// index the playlist declares when the container runs slightly shorter
    /// than the runtime Jellyfin reported.
    var reachedEnd = false
    var lastProducedSegment = 0

    var pendingSeekSegment: Int? = nil
    /// Segment indices with a live segmentURL() request currently waiting on
    /// them, with a count per index (renditions can wait on the same n
    /// concurrently). The producer refuses to throttle while one of these sits
    /// inside its production window.
    var activeWaiters: [Int: Int] = [:]
    var cancelled = false
    var failed = false
    /// True while the pipeline is retrying a failed input read. Segment waiters
    /// stretch their deadline instead of 404ing a promised segment mid-recovery.
    var recovering = false
    /// Input throughput accounting for the cushion diagnostics (pipeline thread
    /// writes, finishSegment logs).
    var inputBytesSinceLog: Int64 = 0
    var lastThroughputLog = Date()
    /// Wall time blocked in av_read_frame while making the current segment, and the bytes that
    /// arrived in it: together one link-rate sample per segment (pipeline thread).
    var readSecondsInSegment: Double = 0
    var bytesInSegment: Int64 = 0
    /// Bytes and read time since the last link sample (one every 512KB; pipeline thread).
    var bytesSinceLinkSample: Int64 = 0
    /// What the other transfers had carried, and when, as the running source sample began.
    var besideAtLinkSample: Int64 = 0
    var linkSampleStartedAt = Date()
    var readSecondsSinceLinkSample: Double = 0
    /// The pull since the pipeline started, for the app's pre-flight (progress(); under stateLock).
    var pulledBytes: Int64 = 0
    var pulledReadSeconds: Double = 0
    /// The source link rate probeLink measured (nil = nothing flowed), and whether it has answered.
    var measuredLinkBps: Double?
    var linkProbeDone = false
    /// Link rate as the current window measured it, the pacing rate for served media.
    var pacedLinkBps: Double?
    var linkWindowBytes: Int64 = 0
    var linkWindowBusySeconds: Double = 0
    var linkWindowStart = Date()
    /// Test seam: stands in for the measured link rate. Never set in production.
    var testLinkBps: Double? = nil
    let startedAt = Date()

    /// Image subtitle decoders by input stream index, built once the input is
    /// open. Written on the pipeline thread, read on the HTTP queue when the app
    /// asks for a cue manifest, so every touch goes through `stateLock`.
    var imageSubtitles: [Int32: ImageSubtitleDecoder] = [:]
    /// PGS tracks decoded from the server's raw stream, by source index, and how far each has read.
    var serverImageSubtitles: [Int32: ImageSubtitleDecoder] = [:]
    var serverImageReadUpTo: [Int32: Double] = [:]
    var serverImageSubtitlesStarted = false

    /// Text subtitle decoders, same lifetime and locking as the image ones.
    var textSubtitles: [Int32: TextSubtitleDecoder] = [:]

    /// The decoder set is decided: every text track that will have a decoder has
    /// one. A track that got none is answered now rather than waited out.
    var subtitleDecodersBuilt = false

    /// Session timeline anchor in seconds: output time is source minus this.
    /// nil until the first keyframe fixes it.
    var sessionAnchorSeconds: Double?

    // Live state. Written on the pipeline thread, read by the playlist under stateLock.
    /// Real length of each closed live segment; cuts land on keyframes, so EXTINF is measured.
    var liveDurations: [Int: Double] = [:]
    /// Wall time each live segment started, for EXT-X-PROGRAM-DATE-TIME.
    var liveDates: [Int: Date] = [:]
    /// Segment index -> generation that opened there. Every entry after segment 0 is a splice.
    var liveGenerationStarts: [Int: Int] = [0: 0]
    /// Splices whose bookkeeping the prune dropped; DISCONTINUITY-SEQUENCE counts them still.
    var liveDiscontinuitiesRemoved = 0
    /// Lowest segment still on disk; MEDIA-SEQUENCE.
    var firstRetainedSegment = 0
    /// Fixed on the first playlist request; TARGETDURATION may not move afterwards.
    var liveTargetDuration: Int?
    /// Longest keyframe interval seen on the source, which bounds a keyframe-aligned cut's overshoot.
    var maxKeyframeGapSeconds: Double = 0
    /// Live: every audio stream the demuxer found, in rendition order; nil until the input is open.
    var liveAudioTracks: [RemuxAudioTrack]? = nil
    /// Live: every image subtitle track the demuxer found; nil until the input is open.
    var liveSubtitles: [RemuxSubtitle]? = nil
    /// Live: the input is open and its streams read; the master playlist waits for this.
    var liveStreamsResolved = false
    /// Copied video whose opening packets carry CEA-608/708 in their SEI; the master declares them.
    var embeddedCaptions = false
    /// Live: the read head on the output timeline, for image cue manifests and their window.
    var demuxedUpToOutput: Double = 0

    /// Slipstream: the adopted grid — start second of each segment, index-
    /// aligned with the server tier's playlist. Empty = fixed 6s grid.
    /// Written once on the pipeline thread before production; playlist and
    /// serving reads go through the grid helpers below.
    var adoptedStarts: [Double] = []
    /// Segment durations of the shared grid (from the canonical rung).
    var adoptedDurations: [Double] = []
    var tierSegments: [Int: [TierSegment]] = [:]
    /// Per rung id, tier segment indices with a rewrapped file on disk (prune).
    var tierMaterialized: [Int: Set<Int>] = [:]
    var supplierRecovery: [SlipstreamSupplier: SupplierRecoveryState] = [:]
    /// Why adoption declined the tier, for the report the master sends.
    var tierUnavailableReason: String? = nil
    /// The opening segment was fetched and rewrapped ahead of the master, or found unavailable.
    var tierProbeResolved = false
    /// The rung the master leads with, latched by the first master, and whether its opening fetch has ended.
    var openingRung: Int?
    var openingRungResolved = false
    /// The master leads with a rung, so the opening segment is a rung's and not the copy's.
    var rungLeads = false
    /// The rung AVPlayer last asked a segment of, and when the producer last moved to follow it.
    var lastTierRung = 0
    var lastFollowSeekAt = Date.distantPast
    /// When the player last gave up a copy segment it had asked for.
    var copyAbandonedAt = Date.distantPast
    /// Live player requests per rung segment, and the transfer behind each. Guarded by fetchLock.
    let fetchLock = NSLock()
    var fetchInterest: [String: Int] = [:]
    var fetchTasks: [String: URLSessionTask] = [:]
    /// Keys whose transfer a release cancelled; the failure that follows is the player's, not the supplier's.
    var fetchAbandoned: Set<String> = []
    /// A follow move failed to seek: the producer holds under a rung for the rest of the session.
    var followDisabled = false
    /// How long that took, for the report: a rung the server feeds slower than it plays is one
    /// the viewer waits on.
    var probeSeconds: Double = 0
    /// A master listing the tier has been served; a drop after that is a mid-session failure.
    var tierListed = false
    var tierReported = false
    /// When the session opened, the origin of the master's wait budget.
    let openedAt = Date()
    /// True once adoptTierGrid has decided (adopted OR declined). The playlist
    /// serving paths wait on this so AVPlayer can never see a pre-adoption
    /// master and a post-adoption media playlist on different grids.
    var gridResolved = false
    var tierActive: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return !adoptedStarts.isEmpty
    }

    /// Slipstream audio-lo: per track POSITION, the adopted server audio-only
    /// rendition — its own grid (audio segments cut on codec frames, not the
    /// video grid) plus the resolved init URL. Adopted lazily on the first
    /// rendition request; nil entry = adoption failed for this session.
    var audioLoSegments: [Int: [TierSegment]] = [:]
    var audioLoInitRemote: [Int: URL] = [:]
    var audioLoInitData: [Int: Data] = [:]
    /// Segment anchors chain within a warm server session: the next expected
    /// index and its exact start (accumulated real durations from the
    /// rewrapper). A non-sequential request re-anchors to the declared grid —
    /// bounded one-codec-frame error at the seek, none during playback.
    var audioLoChain: [Int: (next: Int, start: Double)] = [:]
    /// Materialized audio-lo segment indices per track position (prune
    /// bookkeeping — a chronic tier session would otherwise accumulate the
    /// whole film's audio on disk).
    var audioLoMaterialized: [Int: Set<Int>] = [:]
    /// Producer hold while AVPlayer plays the tier: source reads pause when
    /// segment demand is tier/audio-lo only, so a starving link is not shared
    /// with a pull nobody consumes. Any primary/engine-rendition request
    /// resumes reads instantly (the cushion is already ahead for switch-backs).
    /// distantPast so a session whose first demand is tier-only holds at once
    /// instead of competing with the tier fetches for its first 10 seconds.
    var lastPrimaryDemandAt = Date.distantPast
    var lastTierDemandAt = Date.distantPast
    /// Parsed server WebVTT per text stream index, and the fetches in flight.
    var serverCues: [Int: [ServerCue]] = [:]
    var serverCueFetches: Set<Int> = []
    /// Segment keys with a materialization in flight: a duplicate request
    /// (AVPlayer hangs up and retries slow segments) waits for the winner
    /// instead of stacking parallel server fetches of the same bytes onto
    /// the slow link that made the first fetch slow.
    let inFlightCondition = NSCondition()
    var inFlightKeys: Set<String> = []

    /// Furthest source time the read loop has actually reached, in seconds.
    ///
    /// A seek abandons everything past this point, and the subtitle decoders
    /// need to know where their knowledge stops: their model is "the last
    /// display set wins", so without it a subtitle from before a seek would be
    /// painted over a region we never read. Pipeline thread only.
    var demuxedUpTo: Double = 0

    /// Source-time spans each read generation covered, so a subtitle window waits for the read
    /// that covers it. Under stateLock.
    var readSpans: [(from: Double, upTo: Double)] = []
    var readSpanFrom: Double?
    var readSpanUpTo: Double = 0

    /// Floor, not ceil: the remainder folds into the FINAL segment (which then
    /// runs 6..<12s) instead of becoming a sub-second segment of its own. A
    /// file of 90.018s would otherwise declare a 16th segment holding 18ms
    /// that the producer can never fill — the last packet sits below the 90s
    /// boundary, EOF hits, and AVPlayer turns the declared-but-missing segment
    /// into a hard -1100 error in the final second of playback.
    var segmentCount: Int {
        if config.isLive { return Int.max }
        if !adoptedStarts.isEmpty { return adoptedStarts.count }
        return max(1, Int(config.durationSeconds / Self.segmentDuration))
    }


    /// Called once, on the pipeline thread, as soon as the engine has decided
    /// what to do with every stream. The payload is the dictionary
    /// `LocalRemuxer` forwards to JS as `onEnginePlan`. Set before `start()`.
    var onPlan: (([String: Any]) -> Void)?

    /// One sample per completed segment, on the pipeline thread: how long the
    /// segment took against how long it plays (services/localRemux.ts reads it).
    var onThroughput: (([String: Any]) -> Void)?
    /// Tier sessions only: `listed` or `declined` once, from the master; `dropped` if it dies later.
    var onTier: (([String: Any]) -> Void)?
    /// Once, on the pipeline thread, with the first failure's message; JS ends its pre-flight on it.
    var onFailed: (([String: Any]) -> Void)?
    /// One startup step done (`mark`), on the pipeline thread: the loading screen narrates it.
    var onStage: (([String: Any]) -> Void)?
    /// The measured link rate, whenever it moves materially: the app caps AVPlayer's variant choice
    /// with it (the loopback tells the player nothing about the link behind the engine).
    var onLink: (([String: Any]) -> Void)?
    /// Last rate reported to the app, so a steady link is not re-reported every sample.
    var reportedLinkBps: Double?
    enum CopyVerdict { case undecided, listed, withheld }
    var copyVerdict = CopyVerdict.undecided
    /// A master naming the copy has gone out, so the copy can no longer be taken back.
    var copyAnnounced = false
    /// The renditions are built: the copy can be produced, so a master may name it.
    var sourceReady = false
    var pipelineStarted = false
    var resolvedAudioCodecs: [String: String] = [:]
    var resolvedAudioChannels: [String: Int] = [:]
    var resolvedVideoCodecs: String?
    enum SourceState: String { case dormant, warming, ready, retryWait, unavailable }
    var sourceState = SourceState.warming
    var sourceReleased: Bool { sourceState == .dormant || sourceState == .retryWait || sourceState == .unavailable }
    var sourceUnusable: Bool { sourceState == .unavailable }
    var sourceRetryAttempts = 0
    var sourceRetryAt = Date.distantPast
    var sourceTakeoverSegment: Int?
    var sourceProbeFailure: LinkProbeFailure?
    /// The canonical playlist's own transfer rate: what the ladder is sized by when the source
    /// cannot be read at all, so the probe has nothing to say.
    var playlistLinkBps: Double?
    /// Every server transfer in flight, for a probe to count what the link carried beside it.
    let transfers = TransferLedger()
    /// Server rendition transfers inside the link window, as the spans they arrived over.
    var floorSamples: [(start: Date, end: Date, bytes: Int64)] = []
    /// The last reading of the wire itself (a probe, or the source read), and the newest floor
    /// the server renditions put under it, with when that floor was seen.
    var wireLinkBps: Double?
    var floorLinkBps: Double?
    var floorSeenAt = Date.distantPast
    var lastLinkProbeAt = Date.distantPast
    let reprobeSignal = DispatchSemaphore(value: 0)
    var reprobeAsked = false
    /// Rungs whose playlist was refused or cut on another grid; their routes answer 404.
    var rungsUnavailable: Set<Int> = []
    /// Live: AVPlayer asked for a subtitle rendition's playlist, which it does only while that rendition is selected.
    var onSubtitleRequest: (([String: Any]) -> Void)?
    /// Counts seek restarts; the first segment of a generation carries no time.
    var generation = 0
    var segmentsInGeneration = 0
    var segmentClock = Date()
    /// Set while the loop sleeps on the read-ahead cap, so that segment's time
    /// measures the cap and is flagged rather than read as slow production.
    var sleptOnCap = false

    /// What `reportPlan` last published, so a seek-restart that reaches the same
    /// decisions stays quiet instead of re-emitting on every seek.
    var lastPlanSignature: String?

    init(config: RemuxConfig) throws {
        self.config = config
        if config.serverVideoOnly { sourceState = .unavailable }
        self.aheadWindow = config.readAheadSegments > 0 ? config.readAheadSegments : Self.defaultAheadWindow
        self.keepWindow = config.isLive
            ? max(3, Int(config.liveWindowSeconds / max(1, config.liveSegmentSeconds)))
            : max(20, self.aheadWindow * 2)
        self.liveKeepSegments = max(3, Int(config.liveWindowSeconds / max(1, config.liveSegmentSeconds)))
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let root = caches.appendingPathComponent("localremux", isDirectory: true)
        // Only this session's own directory is created here. This used to wipe
        // the whole root, which deleted the segments of any session still being
        // served — the overlapping-player freeze. Sessions clean up after
        // themselves in stop(); `sweepOrphans` handles anything a crash left.
        dir = root.appendingPathComponent(token, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
}
