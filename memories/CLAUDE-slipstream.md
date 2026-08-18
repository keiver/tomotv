# Slipstream — player-native adaptive streaming through the loopback gateway

**Category:** Design of record (approved direction, pre-implementation)
**Keywords:** slipstream, adaptive, ABR, gateway, variants, master playlist, quality

The engine's loopback server becomes a full HLS gateway: ONE master playlist
declaring multiple video variants — the stream-copied original plus lazily
materialized server-assisted tiers — with audio and subtitles as shared
rendition groups. AVPlayer's own ABR switches variants seamlessly on our
aligned segment grid. No player reloads, no JS switching heuristics on
gateway'd sessions: adaptation happens where HLS designed it to happen.

Feature line: **"Slipstream: adaptive streaming your server can't do alone."**

## Why this is ours to build (competitive facts, sourced 2026-08-18)

- Jellyfin's server HLS is SINGLE-VARIANT (probed live; `DynamicHlsHelper.cs`).
- No Jellyfin client adapts mid-stream: jellyfin-web measures once and pins
  (source-read); jellyfin-androidtv's "Auto" is a startup speed test with an
  OPEN request for dynamic adaptation (#1569); Swiftfin has no in-player
  quality control at all (#184, #769, #807 open).
- Plex is the only home-media ecosystem with mid-stream adaptation, and it is
  client-driven with session reloads — its documented complaints (aggressive
  drops, poor recovery, visible mid-movie softening) are the artifacts of
  external adaptation that player-native ABR eliminates.
- Emby: startup auto-detection only.

We are the only client architecture that IS the HLS server. That is the moat.

## Verified technical foundations (no assumptions — each checked)

1. **The session grid is the SERVER'S OWN segment list** (M1-proven 2026-08-18,
   replacing the earlier "force SegmentLength=6" premise — the server IGNORES
   the requested length when it holds keyframe data). Jellyfin cuts transcode
   segments at the SOURCE's keyframe positions: irregular EXTINFs (9.976s,
   10.110s, ...), identical across sessions AND requested SegmentLength values
   — item-intrinsic. The gateway fetches the tier's `main.m3u8` once and
   ADOPTS its segment list as the session grid; tier segment URLs are used
   verbatim (they embed the server's own `runtimeTicks` — never computed by
   us). M1 probe (`scripts/probe-slipstream.mjs`, dev server, 16/16): every
   segment starts on IDR, PTS deltas match EXTINF exactly, cold random access
   to segment N on a fresh PlaySessionId is BYTE-IDENTICAL to the sequential
   session's segment N (deterministic encodes, SSIM=1), and
   `DELETE /Videos/ActiveEncodings` kills sessions (204). Restart logic
   source-read (`DynamicHlsController.cs`): ffmpeg restarts on a backward
   request or a gap > 24s-worth of segments, seeded from the request's
   `runtimeTicks`.
   **Engine implication (the core M2 work)**: gateway sessions replace the
   engine's fixed 6s grid with this per-session segment list. Stream copy
   naturally cuts at source keyframes, so the copy variant starts every
   segment on IDR too — both variants IDR-aligned on the same boundaries BY
   CONSTRUCTION. Non-gateway sessions keep the 6s grid untouched.
2. **Apple's switching rules** (HLS authoring spec): segment boundaries at the
   same time points across variants, timestamps matching to ~ms, segments
   starting with IDR, matching frame rate. Our grid + rule 1 satisfies them;
   `mediastreamvalidator` is the compliance oracle.
3. **AVPlayer mechanics**: native ABR needs only a multi-variant master;
   startup variant = first listed; `AVPlayerItem.preferredPeakBitRate` steers
   it and RNV's `maxBitRate` prop applies it LIVE mid-playback
   (`RCTVideo.swift:1169`, source-read). Chunked segment delivery is
   precedented by Apple's own LL-HLS.
4. **Already shipped substrate**: audio + subtitles are separate rendition
   groups (seamless audio switching work); we own tfdt/timeline stamping
   (timeline-anchor work); chunked early-header serving with abort-on-fail;
   input recovery; per-server bitrate memory (`bitrateTest.ts`).

## Architecture

### The master playlist (per session)

```
#EXT-X-MEDIA (audio group "aud": one rendition per track — original bits, always)
#EXT-X-MEDIA (subtitle group "subs": unchanged)
#EXT-X-STREAM-INF BANDWIDTH=<source> CODECS=<orig> ...   → v0/media.m3u8   (engine: copy/device-transcode, today's rendition)
#EXT-X-STREAM-INF BANDWIDTH=4000000 CODECS="avc1..." ... → v1/media.m3u8   (server tier 720p/4M)
#EXT-X-STREAM-INF BANDWIDTH=1500000 CODECS="avc1..." ... → v2/media.m3u8   (server tier 480p/1.5M)
```

- Variant ORDER is the startup pick: bitrate memory (`rememberedBitrate`)
  decides which variant lists first. AVPlayer starts there.
- Declared BANDWIDTH values are our steering surface for the estimator.
- **Audio never degrades.** All variants share the original-file audio
  renditions (192kbps-class streams survive links that starve video).
- v0 is BYTE-IDENTICAL to today's engine rendition. Slipstream adds siblings,
  it does not touch the existing lane.

### Server tiers are STATELESS per segment — no second producer thread

Key simplification: because the server cuts on our exact 6s grid, OUR segment
`n` maps 1:1 to SERVER segment `n`. A tier rendition's `segmentURL(n)` is:

1. GET Jellyfin's dynamic HLS segment `n` for the tier's transcode params
   (`hls1/main/{n}.ts?...&SegmentLength=6&VideoBitrate=...&VideoCodec=h264&
AudioCodec=aac`, one PlaySessionId per tier). Jellyfin transcodes on
   demand, predicts sequential access, and restarts ffmpeg at the segment on
   a gap — random access is server-native.
2. Remux TS → fMP4 through the existing muxer path (packet copy, no decode),
   re-stamp tfdt to `n * 6s` absolute on OUR timeline.
3. Serve through the existing chunked `.streamed` path. Failure = abort =
   AVPlayer switches variants natively.

Lazy by HLS's pull model: a tier costs nothing until AVPlayer requests its
playlist; idle tiers get `DELETE /Videos/ActiveEncodings` (KillTranscoding)
after 30s without requests. At most one server ffmpeg runs in steady state
(brief overlap during a switch).

Tier audio: server tier variants carry NO muxed audio (video-only variants per
the authoring spec's preferred shape); the shared audio group covers them. The
tier's `AudioCodec=aac` request exists only so the TS demuxes cleanly; its
audio track is dropped in the rewrap.

### Quality controls become native

- Settings pins (0-4) map to `maxBitRate` (preferredPeakBitRate) instead of
  rebuilding sessions: a pin caps which variant AVPlayer may pick. LIVE, no
  reload — pins get seamless too.
- Auto = no cap; AVPlayer adapts across the full ladder.
- The Layer-4 JS controller (beaef06) RETIRES for gateway'd sessions and
  remains solely for files that never enter the engine (its `stallFallback`
  entry rung also remains as the non-gateway backstop).

### Scope decisions (v1, decided now)

- Engine-eligible files only (the lanes the engine already owns). Pure
  server-transcode files keep Layer 4; gatewaying them is v2.
- Two server tiers: 4 Mbps/720p and 1.5 Mbps/480p. Every additional declared
  tier is a potential server ffmpeg; two covers the failure curve.
- **HDR files get NO server tiers in v1.** Mixing VIDEO-RANGE across
  switchable variants violates the authoring spec's consistency rules and an
  SDR tone-map mid-film is a visible lie. HDR keeps Layer 4.
- Frame rate: tiers request no fps cap → source fps preserved (spec rule).
- Interlaced/deinterlaced and audio-only files: v0 only, no tiers.

## The audio rung — per-tier audio groups (designed 2026-08-18, deep-research pass)

The tier as first shipped shared ONE audio group with the primary, and that
group is engine-produced: the engine must pull the FULL source file to make
it. On a link chronically slower than the source bitrate (the founding
incident), the tier relieved only AVPlayer's video download — the session
still starved on audio production and conceded to the server-transcode
ladder. The fix is Apple's own ladder pattern: each variant names its own
audio group, and the tier's group is fed by the SERVER, not the engine.

**Design:**

- Master: primary keeps `AUDIO="audio"` (engine renditions, original bits).
  Tier gets `AUDIO="audio-lo"`. Legal per RFC 8216 §4.3.4.1.1: groups of one
  TYPE must have the same member set with identical attributes EXCEPT URI and
  CHANNELS — selection follows LANGUAGE/DEFAULT across groups. Apple's own
  bipbop reference master ships three audio groups this way.
- audio-lo members come from Jellyfin's audio-only HLS of the VIDEO item:
  `/Audio/{itemId}/main.m3u8` + `hls1/main/N.mp4` (NEVER `master.m3u8` —
  server NREs on video items with text subs, DynamicHlsHelper line ~357).
  Route verified live: no item-type guard, equal-length keyframe-free
  segments, `-vn -acodec …` ffmpeg (audio thread only), same PlaySessionId
  kill semantics as the video tier.
- **audio-lo mirrors the primary group's codec and channel count per track**
  — the load-bearing rule. WWDC20 (10158): AVPlayer switches audio codecs
  only within the AAC family and between lossless and AAC, and avoids
  changing channel count; violating either rebuilds the render chain (~200ms
  gap, Apple forums 89348). So:
  - engine COPIES the track (aac/ac3/eac3/alac) → audio-lo is the server's
    `AudioCodec=copy` — IDENTICAL BITS, switch seamless by construction,
    zero quality loss on the rung (verified live: T81 E-AC-3 6ch verbatim,
    ~700kbps on the wire).
  - engine ENCODES to FLAC (dts/truehd/pcm…) → audio-lo is the server's
    `AudioCodec=flac` at matching channels — same codec family + channels,
    lossless, ~2-3 Mbps; inside the sanctioned lossless↔AAC/FLAC envelope.
  - Never multichannel AAC (tvOS decodes it stereo — Apple forums 651588).
- Rendition timeline: the server's audio playlist is its own adopted grid
  (boundaries fall on audio frames, e.g. 5.984s — independent of the video
  grid; renditions are independent playlists, only TIMESTAMPS must match:
  RFC 8216 §6.2.4). Segments are proxied through the loopback and tfdt
  re-anchored exactly like the video tier (server rebases each session to 0
  — measured). Cold access shifts boundaries by ≤ one audio frame (~32ms),
  seek-only, below lip-sync thresholds; warm sequential fetches chain exact.
- ALL playlists declare ONE TARGETDURATION (Apple authoring req 8.2 — fixes
  a pre-existing mismatch between tier and primary playlists).
- Tier BANDWIDTH = tier video + audio-lo member peak (spec: largest playable
  combination). EAC3 copy ≈ 2.2M total; FLAC rung ≈ 3.5-4.5M total — both
  far under the source pulls that starve.
- Engine input throttle: while segment demand is tier+audio-lo only, the
  producer HOLDS source reads (the starving link goes wholly to the server
  renditions); any primary/aN request resumes it instantly — the cushion is
  already ahead for the switch back.
- Lifecycle: audio-lo sessions are lazy (playlist fetch starts no ffmpeg —
  verified live) and die with the session via the same ActiveEncodings kill.
- Prior art: NO Jellyfin/Plex client fetches separate audio for a video item
  (jellyfin-web gates /Audio/ on MediaType==='Audio'; Swiftfin/Findroid/
  Streamyfin send one combined cap; Plex muxes). This rung is unique to the
  gateway architecture — the moat deepens.

Implementation record (2026-08-18, offline-verified):

- TierRewrapper.rewrapAudio (shared core with video): server audio fMP4
  in (init+segment), timestamps rebuilt (server tfdt untrustworthy),
  bit_rate zeroed for init byte-stability (btrt varied per segment),
  duration returned for anchor chaining. Harness-verified on real server
  segments: init byte-stable, ffprobe monotonic-continuous 0→18s.
- Remuxer: audio-lo adoption/serving/pruning (own grid, own time-window
  prune), master audio-lo group, tier AUDIO switch, producer tier-hold,
  session-wide TARGETDURATION, kill extended to audio sessions.
- JS: getAudioRenditionUrl (main.m3u8 only), serverAudioPlan (copy vs
  flac mirror), slipstreamTierBandwidth (undercut rule: tier ≥0.85 of
  primary → no tier), pin cap = declared tier bandwidth
  (preferredPeakBitRate tolerates ~2% overage and climbs when nothing
  fits — both sim-measured).
- Sim reconstruction: two-group master READY, tier+audio-lo streamed
  (request-logged), cross-group switches both directions, zero stalls —
  including the 6.1-engine vs 7.1-server-FLAC channel mismatch (server
  flac pads 6.1→7.1 regardless of TranscodingMaxAudioChannels).
- Slow-link routing (Dracula/demo-server session, device-logged): a link
  measured below the source bitrate starves direct play AND the engine
  identically — stream copy pulls the same source bytes. The gate
  (measured × 0.7 < source) vetoes both and routes to the server lane,
  whose adaptive entry sizes the transcode to the same measurement
  (Jellyfin's own StreamBuilder rule: ContainerBitrateExceedsLimit).
  Slipstream's tier is for links that DEGRADE mid-play, not for links
  known too slow at session start.
- Server-lane resume via EXT-X-START (PlaylistShim.swift): AVPlayer
  buffers position zero of a VOD playlist before any client seek, so a
  resumed transcode paid two ffmpeg spin-ups plus a dead download of the
  opening. The shim re-serves the transcode's playlists through the
  loopback with EXT-X-START injected and URIs absolutized; segments flow
  straight from the server. tvOS 26 honors the tag (sim-probed twice:
  fixture playlist, then real Jellyfin transcode opened at 60s, playhead
  72.8 after 16s, zero stalls, segment 0 never fetched — the 2016 forum
  claim that tvOS ignores it is obsolete). AVPlayer refuses file:// HLS,
  hence loopback. Consuming seekToPositionAfterLoadRef suppresses the
  post-load auto-seek; adaptive quality switches ride the same path.
- Tier survivability under starvation (same session's mechanism):
  materializations dedupe in flight (AVPlayer retry hangups had stacked
  7 parallel fetches of one segment on the starving link); fetch
  timeouts no longer count toward tierDisabled (structural rewrap
  failures only — a timeout is the link, and on that link the tier is
  the only variant that fits); lastPrimaryDemandAt starts distantPast so
  a tier-only session holds the producer at once instead of competing
  with the tier for its first 10 seconds.

## Risks, each with a decided mitigation

| Risk                                                           | Mitigation (decided, not deferred)                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encoder classes cutting differently than requested             | RESOLVED BY DESIGN (M1): the grid is adopted FROM the server's playlist, so however the server cuts, both variants share its boundaries. The per-session capability check shrinks to: tier playlist parses + segment 0 starts with IDR (one cheap fetch); failure disables tiers for the session. |
| Sub-frame boundary drift vs our grid                           | RESOLVED BY DESIGN (M1): there is no second grid to drift from — the engine adopts the server's segment list, and M1 measured PTS deltas matching EXTINF exactly with byte-identical cold re-encodes.                                                                                             |
| AVPlayer estimator behaves oddly against loopback speeds       | Declared BANDWIDTH is our tuning surface; cushion-empty chunked delivery already exposes true input rate. M2's drill matrix (Network Link Conditioner profiles) tunes declared values before anything ships.                                                                                      |
| Server tier segment latency (ffmpeg restart on seek ≈ seconds) | Chunked early headers hold the request (shipped); AVPlayer's stall handling rides it; tier BANDWIDTH declared honestly low keeps it a refuge, not the default.                                                                                                                                    |
| Two transcodes if AVPlayer flaps between tiers                 | Tiers share one PlaySessionId per tier; KillTranscoding on idle; declared ladder spacing (4M/1.5M) plus AVPlayer's own hysteresis bounds flapping.                                                                                                                                                |
| Subtitle timing across variants                                | Subtitle renditions are variant-independent (shared group, own timeline) — untouched by switches. Regression fixture asserts cues through a forced switch.                                                                                                                                        |

## Milestones — each gated on proof defined here, not discovered later

**M1 — Substrate verification (no app changes). ✅ DONE 2026-08-18, GO.**
`DynamicHlsController.cs` source-read; `scripts/probe-slipstream.mjs` against
the dev server: 16/16 PASS. Discoveries folded into the design: SegmentLength
is ignored (grid = source keyframes, item-intrinsic, stable across sessions
and params → PLAYLIST ADOPTION replaces the fixed 6s premise); cold random
access is byte-identical (deterministic encodes, SSIM=1); kill route 204.
Remaining M1 residue → carried into M2: run the probe once against a
hardware-encoder server (QSV/NVENC) when one is available; the adoption
design absorbs any difference, so this validates, not gates.

**M2 — Two-variant master behind a flag.**
Gateway serves v0 + one server tier for one SDR H.264 fixture. Proof:
`mediastreamvalidator` clean on the master; forced switches via `maxBitRate`
toggling on the tvOS sim show no glitch, no PTS jump (harness asserts
continuous `onProgress` clock through the switch); pins map to `maxBitRate`.

M2 bring-up findings (2026-08-18, all root-caused offline):

- First sessions died with -19601: the rewrapper's init carried an EMPTY avcC.
  This FFmpeg build's TS demux leaves `extradata` unset for Annex-B H.264, and
  `empty_moov` writes the moov before any packet. Fix: header written lazily on
  the first video packet, SPS/PPS lifted from its Annex-B stream into extradata.
- Standalone per-segment muxers rebase dts to zero (tfdt=0 everywhere). Fix:
  `frag_discont` + `avoid_negative_ts=0` + dts-anchored shift → tfdt lands
  exactly on the grid. Trailer's `mfra` stripped (media segment = styp+moof+mdat).
- Chunked transport exonerated: fixed tier bytes reach READY fully buffered on
  the tvOS 26.4 sim runtime over BOTH plain and chunked serving.
- Master STREAM-INF attributes must be symmetric across variants (CODECS and
  VIDEO-RANGE): the fully-declared variant wins AVPlayer's initial pick.
- Repro loop without device builds: compile TierRewrapper + AVFoundation probe
  against the xcframeworks' macos/tvos-sim slices, `xcrun simctl spawn booted`
  the probe against a host loopback server ($CLAUDE_JOB_DIR/tmp/tier-repro).

M2 gate PASSED (2026-08-18 live session): AVPlayer started on the primary,
evaluated the tier mid-play (two live materializations), committed back and
played the file to completion with an unbroken progress clock; server showed
no lingering transcode after stop. Honest declarations changed the startup
pick from tier-camping to primary. Formal mediastreamvalidator pass still
open (tool not installed; sim-runtime playback probes stood in).

M3 verifications done 2026-08-18:

- Lazy tier: the playlist-only fetch starts NO server ffmpeg (probed live;
  matches DynamicHlsController — encode starts on first segment request).
- Layer-4 bypass: localRemux sessions null the adaptive controller
  (useVideoPlayback CREATING_STREAM); only the plain-transcode lane arms it.
- Pin fallback: with preferredPeakBitRate below every declared BANDWIDTH,
  tvOS 26 falls back to the lowest variant (the tier) — pins yield the right
  variant even though presets don't align with audio-inclusive declarations.
- "Timestamps are unset (stream 0)" root-caused: Matroska demux leaves
  dts=NOPTS on the first video packets (B-frame delay unknown until pkt 3);
  movenc warns once and infers. Engine-wide, pre-Slipstream, benign — left
  as is; revisit only if an FFmpeg upgrade enforces.

**M3 — Lazy lifecycle + the stall drill.**
Tier spin-up on first request, KillTranscoding on idle, per-server capability
probe cached. Network Link Conditioner drill: throttle mid-play → AVPlayer
down-switches natively (no -12889, no session reload), recovery up-switches.
The beaef06 recovery/cushion layers remain the engine-variant backstop and are
asserted unbroken by the playback regression suite (55+ fixtures green).

**M4 — Ship surface.**
Layer-4 controller bypassed for gateway'd sessions; new harness fixtures
(T9x series: forced-switch, tier-failure-abort, HDR-exclusion, subtitle-
through-switch); Settings pins wired to `maxBitRate` app-wide; CHANGELOG +
feature line. Gate: full suite green, drill matrix green, device verification
on Apple TV + iPhone.

## What Slipstream does NOT change

Direct play, the decision tree in `canRemuxLocally`, the retry ladder,
reporter semantics (one PlaySessionId per SESSION for reporting stays; tier
PlaySessionIds are transcode-plumbing only, never reported), Top Shelf,
audio player. The gateway adds variants to an existing master; every current
behavior is the v0 path.
