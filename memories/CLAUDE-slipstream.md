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

## Risks, each with a decided mitigation

| Risk | Mitigation (decided, not deferred) |
|---|---|
| Encoder classes cutting differently than requested | RESOLVED BY DESIGN (M1): the grid is adopted FROM the server's playlist, so however the server cuts, both variants share its boundaries. The per-session capability check shrinks to: tier playlist parses + segment 0 starts with IDR (one cheap fetch); failure disables tiers for the session. |
| Sub-frame boundary drift vs our grid | RESOLVED BY DESIGN (M1): there is no second grid to drift from — the engine adopts the server's segment list, and M1 measured PTS deltas matching EXTINF exactly with byte-identical cold re-encodes. |
| AVPlayer estimator behaves oddly against loopback speeds | Declared BANDWIDTH is our tuning surface; cushion-empty chunked delivery already exposes true input rate. M2's drill matrix (Network Link Conditioner profiles) tunes declared values before anything ships. |
| Server tier segment latency (ffmpeg restart on seek ≈ seconds) | Chunked early headers hold the request (shipped); AVPlayer's stall handling rides it; tier BANDWIDTH declared honestly low keeps it a refuge, not the default. |
| Two transcodes if AVPlayer flaps between tiers | Tiers share one PlaySessionId per tier; KillTranscoding on idle; declared ladder spacing (4M/1.5M) plus AVPlayer's own hysteresis bounds flapping. |
| Subtitle timing across variants | Subtitle renditions are variant-independent (shared group, own timeline) — untouched by switches. Regression fixture asserts cues through a forced switch. |

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
