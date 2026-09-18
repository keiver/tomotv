# Slipstream: player-native adaptive streaming through the loopback gateway

**Category:** Shipped behaviour (2.2.7). Read this before touching the master
playlist, the link measurement or the variant cap.
**Keywords:** slipstream, adaptive, ABR, gateway, variants, master playlist, quality

The engine's loopback server is a full HLS gateway: ONE master playlist per
session, declaring the device's own stream copy beside server-fed rungs, with
audio and subtitles as rendition groups. AVPlayer's own ABR moves between them
on a shared segment grid. The app never switches variants itself; it measures
the link and tells AVPlayer what the link can carry.

## Why this is ours to build (competitive facts, sourced 2026-08-18)

- Jellyfin's server HLS is SINGLE-VARIANT (probed live; `DynamicHlsHelper.cs`).
- No Jellyfin client adapts mid-stream: jellyfin-web measures once and pins
  (source-read); jellyfin-androidtv's "Auto" is a startup speed test (#1569);
  Swiftfin has no in-player quality control at all (#184, #769, #807 open).
- Plex is the only home-media ecosystem with mid-stream adaptation, and it is
  client-driven with session reloads.
- Emby: startup auto-detection only.

We are the only client architecture that IS the HLS server. That is the moat.

## The master (RemuxSession+Playlists.swift)

```
#EXT-X-MEDIA TYPE=AUDIO GROUP-ID="audio"     one rendition per track, the engine's own bits
#EXT-X-MEDIA TYPE=AUDIO GROUP-ID="audio-lo"  the same tracks at 96 kb/s stereo AAC, from the server
#EXT-X-MEDIA TYPE=SUBTITLES GROUP-ID="subs"  one rendition per text track, shared by every variant
#EXT-X-STREAM-INF BANDWIDTH=<source> AUDIO="audio"    → media.m3u8   the on-device copy
#EXT-X-STREAM-INF BANDWIDTH=236000   AUDIO="audio-lo" → t0.m3u8      the server ladder, ascending
...
```

- **The first variant listed is where AVPlayer starts.** The copy leads when
  `source * 1.2 <= measured link`; otherwise the largest rung that fits leads.
- **A link that cannot carry the copy is not offered the copy at all.** AVPlayer
  evaluates every variant it is listed, and a copy segment a slow link cannot
  finish inside its 6s watchdog fails the whole item (-12889, measured at
  0.6 Mb/s). One rung of headroom above the fitting set stays listed so a
  recovering link has somewhere to climb without a new session.
- Rungs ride `audio-lo` and the copy rides `audio`: the ladder is the degraded
  path, and 96 kb/s stereo is what a link in trouble can spare. Subtitles are
  one group for every variant, so no switch moves the viewer's track.
- `CLOSED-CAPTIONS` is mirrored across variants (RFC 8216 4.3.4.2): NONE
  everywhere, or the `cc` group when the copied packets carry A/53 captions.
- BANDWIDTH counts the variant plus the audio group it plays with (4.3.4.2).

## The ladder (services/localRemux.ts)

`SLIPSTREAM_LADDER`, ascending: 140k and 240k at 256x144, 400k at 426x240,
800k at 640x360, 1.5M at 854x480, 4M at 1280x720, 6M at 1920x1080. A rung is
offered when `rung + 96k` undercuts the source total by 0.85. The 140k rung is
sized for STARTUP, not for the steady state: AVPlayer buffers about two
segments before the first frame, and on a 0.6 Mb/s link those bytes are the
whole budget.

Eligibility (`slipstreamEligible`): SDR video, at least one carriable audio
track, a server source (never a held file), not a live channel. HDR is excluded
because mixing VIDEO-RANGE across switchable variants breaks the authoring
spec, and a tone-map mid-film is a visible lie.

## Measuring the link (RemuxSession+LinkProbe.swift)

AVPlayer measures the loopback, which says nothing about the wire, so the
engine measures it itself:

- **At startup**, a range read of the source (512 KB or half the source rate),
  timed from the first byte, 1.5s window. The master waits on this.
- **During playback**, every server transfer folds into an 8s window
  (`noteLinkSample`), timed by the body transfer alone. The whole request is
  the wrong clock: it counts Jellyfin's encode wait as link time, which froze
  the rate at 0.87 Mb/s on a recovered 30 Mb/s link.
- **While a rung plays**, the source is re-read every 30s (`linkRepeatSeconds`).
  A rung segment is streamed as it is encoded, so even its transfer window
  measures the encoder: the same recovered link read 2.59 Mb/s from rungs and
  30 Mb/s from the source.
- A move of more than 15% is reported to the app (`onEngineLink`), carrying the
  rate and whether this session's master lists the copy.

## What the app does with it (hooks/useVideoPlayback.ts)

- **Cap**: `max(measured * 0.8, smallest listed variant)` applied live through
  RNV's `maxBitRate` (preferredPeakBitRate). The floor matters: a cap under
  every variant leaves AVPlayer nothing it may play and it shows no frame at
  all. A pinned quality preset is the cap instead, and no report moves it.
- **Climb**: a session whose master has no copy rebuilds at the playhead once
  the link has carried `source * 1.2` for 5s, with a 60s cooldown. The hold is
  a TIMER, not the next report: a link fast enough to fill the rung read-ahead
  stops the engine's server reads, and with them the reports.
- **Startup cushion**: rung sessions ask for 12s of forward buffer
  (`preferredForwardBufferDuration`), handed back to AVPlayer the moment the
  picture is up. Holding it for the whole session costs what it buys: a 30 to
  1.5 Mb/s drop found 6s buffered and stalled 37s.
- The session's audio and subtitle tracks survive every step, including the
  hand-over to the server: AVPlayer's own auto-selection is not read as the
  viewer's choice, and a rebuilt session re-applies the viewer's track by
  position in the new manifest.

## Segments and the grid

- The grid is the SERVER'S segment list, adopted from the canonical rung's
  playlist: Jellyfin cuts at the source's keyframes, ignores the requested
  SegmentLength, and cold random access is byte-identical (16/16 in
  `scripts/probe-slipstream.mjs`, which is kept for re-proving that against a
  hardware-encoder server). Stream copy cuts at those same keyframes, so both
  variants are IDR-aligned by construction.
- Rungs the measured link cannot carry are fetched BEHIND the master, not
  before it: five playlists cost 256 KB, and on a 0.6 Mb/s link that is 3.4s
  the first video segment needs.
- A rung's init comes from the first 64 KB of its opening segment
  (`tierInitHeadBytes`), proven byte-identical to the init from the whole
  3.2 MB segment.
- The rung is proved before the master lists it: the opening segment is fetched
  and rewrapped, and a refusal or timeout declines the rung with a reason
  (`onEngineTier`, the Diagnostics `tier` entry).
- Starting on a rung holds the engine's source pull, so the slow link goes
  wholly to the server renditions; any copy request resumes it.
- A session riding a rung serves the SERVER's WebVTT for text subtitles: the
  engine's own cues come from a source pull that is being held, and AVPlayer
  drops the item if a subtitle window misses its 6s deadline.

## The acceptance matrix (scripts/abr-drill.mjs)

`scripts/netsim-proxy.mjs` shapes one token bucket in front of Jellyfin; the
drill plays a fixture through it and scores the timeline
(`scripts/lib/abr-score.mjs`).

| Scenario | Link                           | Asserts                                    |
| -------- | ------------------------------ | ------------------------------------------ |
| S1       | unthrottled                    | opens on the copy and stays there          |
| S2       | 1.5 Mb/s                       | opens on a rung, no stall                  |
| S3       | 30 → 1.5 at 60s                | steps down, no stall                       |
| S4       | 1.5 → 30 at 60s                | climbs back to the copy                    |
| S5       | 0.6 Mb/s                       | plays at all, no stall                     |
| S6       | 3 ↔ 6 every 20s                | does not flap                              |
| S7       | down then up, two audio tracks | steps down, climbs back, keeps both tracks |
| S8       | rung playlists refused         | survives by handing over to the server     |

Every scenario also asserts no reload, and that every audio and subtitle track
is still listed at the end.

```bash
node scripts/abr-drill.mjs --host                       # macOS AVPlayer + the real engine
node scripts/abr-drill.mjs --device "Main Bedroom"      # the app on the Apple TV
#   --items T101,T102  --scenarios S1,S4  --link 1500000  --buffer 12  --no-window  --no-cap
```

Host and device both run 15/15 (T101 and T102, S1-S8) as of 2026-09-17: copy in
1.1s unthrottled, 0.6 Mb/s to first frame in about 20s, climb back within 19 to
86s of recovery, no stalls, no dropped tracks.

## What Slipstream does NOT change

Direct play, the decision tree in `canRemuxLocally`, the retry ladder, reporter
semantics (one PlaySessionId per SESSION for reporting; rung PlaySessionIds are
transcode plumbing and are never reported), Top Shelf, the audio player. The
gateway adds variants to a master that already existed.
