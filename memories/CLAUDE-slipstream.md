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
#EXT-X-STREAM-INF BANDWIDTH=260000   AUDIO="audio-lo" → t0.m3u8      the server ladder, ascending
...
```

- **The first variant listed is where AVPlayer starts**, and `startsOnFirstEligibleVariant` makes
  that ours to decide (RNV patch; since tvOS 13 AVPlayer otherwise picks its own).
  - The copy is LISTED when `source * 1.2 <= measured link`.
  - The copy LEADS only when `source * 3 <= measured link` (`copyLeadsMargin`), the link on which
    its first 6s segment lands in 2s. Leading at 12 Mb/s (1.9x) its 4.7 MB opening segment took
    3.7s, AVPlayer hedged onto the bottom rung and showed a frame at 8.6s; it then climbed to the
    copy on the same item by itself. Under 3x a rung leads and the copy stays listed.
  - The rung that leads is the biggest whose segment lands in about a second: `bandwidth * 6 <=
link` (`openingRungShare`, `chooseOpeningRung`), so t0 up to 2 Mb/s and 480p at 12 Mb/s.
    Opening on the biggest rung that FIT cost 12.7s at 1.5 Mb/s. Opening everyone on t0 showed
    144p for the first 42s of media at 12 Mb/s: AVPlayer read 0.69 Mb/s off the tiny segments and
    fetched thirteen of them in 7s once the forward buffer opened. Off a 480p opening it reads
    the wire (12 Mb/s) and reaches the copy at 75 to 79s (four runs, both fixtures).
  - The leading rung's opening segment is fetched the moment the link is known, since its server
    transcode is a second or two of spin-up. NEVER beside a copy that leads: at 30 Mb/s the 3 MB
    of t5 took the link from the copy's first segment and AVPlayer opened on t0.
- **The copy is decided once** (`decideCopy`, `copyVerdict`), and the pipeline and the master act
  on the same answer. A probe that read nothing is a SLOW link, never an unlimited one.
- **A link that cannot carry the copy is not offered the copy at all.** AVPlayer
  evaluates every variant it is listed, and a copy segment a slow link cannot
  finish inside its 6s watchdog fails the whole item (-12889, measured at
  0.6 Mb/s, with the cap in force). One rung of headroom above the fitting set stays listed so a
  recovering link has somewhere to climb without a new session.
- **A master names the copy only once it can be produced** (`sourceReady`, the renditions built).
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

## The source is let go when the rungs carry the session (RemuxSession+Lifecycle.swift)

The pipeline waits for the link's verdict BEFORE it opens the input at all. An open stream nobody
reads still fills the socket's buffers: it took 40% of the link out from under the probe (12 Mb/s
read as 7.4), the copy was withheld, the repeat probe read 12, the app rebuilt, and the new
session read low again, eight times in 90s. And a link that cannot carry the copy has no use for
the source: `find_stream_info` alone pulled 573 KB, 5.8s of a 0.6 Mb/s first frame.
`releaseSource` never opens it, and the session runs as a gateway over the server's rungs, when
the copy is withheld, the grid is adopted, every audio track has a server rendition
(`audioLoActive`), and no track needs the demuxer (`demuxerOwesTracks`: an image subtitle, or an
engine text track with no server WebVTT).

The same release catches a source that will not open or cannot be planned (`failStartup`): the
rungs carry the session instead of the server lane, which has no ladder. So does a probe the
server answers with an error status (`LinkMeter.refused`, `sourceRefused`): read as a slow link it
was released as rebuildable, and the app rebuilt four times toward a copy nothing could produce.
The link report then says `copyListed: true`, so the app never rebuilds toward a copy that cannot
exist. A failure after a master has named the copy is still a failure.

## The producer under a rung (RemuxSession+Pipeline.swift, RemuxSession+Tier.swift)

While AVPlayer plays a rung, the producer does one of two things (`copyFollowsLocked`):

- **Follows**, when the master names the copy and the wire carries it beside the rung being
  played (`wire >= source * 1.2 + rung`): it keeps `followSegments` of the copy just past
  AVPlayer's latest rung fetch (`followLocked`), moving at most once per segment length, so
  AVPlayer's next try at the copy lands on disk and not on a cold seek of the source. A move that
  fails to seek ends following for the session, never the session.
- **Holds** otherwise: a link with no room is not shared with a pull nobody plays.

A rung that leads the master has the link to itself until its opening segment lands
(`openingHoldLocked`). Every rung request marks where AVPlayer is, a segment served from disk
included (`tierSegmentResponse`).

## A segment AVPlayer gave up (LocalHTTPServer.swift, RemuxSession+Tier.swift)

Measured: when AVPlayer abandons a segment it resets the connection, and the server's
`NWConnection` goes `.failed` within half a second; a half-closed client never looks like that.
`sendStreamed` hands each `.segment` provider a `SegmentRequest` and marks it abandoned on
`.failed`, `.cancelled` or a failed padding send. A rung fetch is cancelled when the last live
request for its segment is gone (`withFetchInterest`; a cancelled fetch is status 0, never a tier
failure, and the engine's own opening fetch is never cancelled). The copy's wait loop ends the
same way, and a rung asked for after an abandoned copy request counts as riding at once
(`ridingTierLocked`), not after ten seconds.

## A source lost mid-play (RemuxSession+Lifecycle.swift `handOverToRungs`)

Once the master has named the copy, `fail()` no longer ends a session the ladder can carry: the
source is marked released and unusable, `failed` stays false, and the copy's routes (segments,
init, engine audio) answer **410**. Measured, and Apple says it of permanent errors (WWDC17 514):
AVPlayer does not retry a 410 and moves to another variant of the same master. A gone copy is
not demand on the source. A session with no producer prunes its rungs from the rung path.

## Image subtitles from the server (RemuxSession+ServerImageSubtitles.swift)

The server hands an embedded image track over raw, and the extension follows the codec
(measured on Jellyfin 12): PGS is `/Videos/{id}/{id}/Subtitles/{index}/Stream.pgssub`, a SUP
stream (`.sup` and `.mks` answer 400 for it); DVD is `Stream.mks`, Matroska holding
`dvd_subtitle` with its palette (`.sub`, `.idx`, `.vobsub`, `.dvdsub` answer 400). Both are
extracted with `-c:s copy` and no `-copyts`, so their cues are session time. Such a track names
the stream as `serverSupUrl` whenever rungs are offered, and then no longer keeps the source open
(`demuxerOwesTracks`). The reader names the `sup` input format for a `.pgssub` URL and probes
anything else, feeds a second `ImageSubtitleDecoder` (files `pgs{index}s-*`), and the cue
manifest answers from it once it is complete or when the demuxer is not feeding. It starts once,
only when the source is let go, lost, or held under a rung. DVB, XSUB and sidecar image files
have no measured raw route and stay owed.

## Surround on the upper rungs (services/localRemux.ts `rungAudio`, RemuxSession+AudioLo.swift)

Two server audio groups, both AAC. `audio-lo` is 96 kb/s stereo. `audio-hi` is the track at its
own channel count, six at most, 64 kb/s a channel (measured: the server's AAC 5.1 at 384 kb/s;
its AC-3 copy exits 134 on Jellyfin 12). A rung rides hi once its video is at least twice the
default track's hi rate (800 kb/s and up for 5.1), and its BANDWIDTH carries that rate, through
one helper that also feeds the app's caps. Every track is in both groups. A stereo item has no
hi group and its master is unchanged. Natively both groups are one code path keyed by
(position, hi): files and routes `a{p}s-*` and `a{p}h-*`.

Both groups are fetched from `/Videos/{id}/main.m3u8` with a 64px, 20 kb/s picture, never from
`/Audio/{id}/main.m3u8`. Measured on Jellyfin 12.0.0: the audio route builds FFmpeg with no `-map`,
so every `AudioStreamIndex` returned the same stream (T102 tracks 1 and 2 both gave `#0:1`), and
it exits 134 on T09. The video route maps the track (`-map 0:0 -map 0:2`), costs 16 to 18 KB a
segment (`AUDIO_CARRIER_BITRATE`, counted in each rung's BANDWIDTH), and `TierRewrapper` keeps
only the audio. No group carries CHANNELS, against RFC 8216 4.3.4.1. Measured on the host drill,
S6, two runs each way: with `CHANNELS="6"` on `audio-hi` AVPlayer on a stereo output never left the
`audio-lo` rungs (240p for 160s on 3 to 6 Mb/s); without it the same run reached 1080p by 107s and
crossed to `audio-hi` at 24s.

## Measuring the link (RemuxSession+LinkProbe.swift)

AVPlayer measures the loopback, which says nothing about the wire, so the
engine measures it itself. Two kinds of evidence, kept apart:

- **The wire**: a range read of the source (the probe), and the copy pipeline's own reads WHILE
  NOTHING ELSE TRANSFERS. These may move the rate either way. A source read beside a rung or an
  audio transfer is that read's share of the link: it is counted with what ran beside it, over
  the wall clock, as a floor. The producer's bytes go in the `TransferLedger` as they are read,
  so a probe taken beside the producer counts them.
- **A floor**: rung and audio-lo transfers. A rung is sent as it is encoded, so its pace is a
  floor under the link, never a reading of it (a recovered 30 Mb/s link read 2.59 Mb/s from rungs).
  A floor may RAISE the rate and never lowers it, and its time is the UNION of overlapping
  transfers: adding a rung's span to its audio's halved a 1.5 Mb/s link.
- **A probe counts what ran beside it** (`TransferLedger`): alone it reads its share of a busy
  link. Measured on 0.6 Mb/s: 0.20 alone, 0.59 with the bytes beside it; on 1.5: 0.75 and 1.50.
- The startup probe ends early on a link already reading 2.4x the source over a megabyte (every
  further byte is one the first copy segment waits behind), at 0.75s once the rate is level, and
  at 1.5s while it is still climbing. A first byte may take 3s.
- **While a rung plays** the wire is re-read every 30s, except while rungs arrive at the pace it
  last read (they ARE the wire then, and a probe takes half a thin link for its length: at
  750 kb/s the segment beside it ran past 6s and AVPlayer stepped down). A probe is asked for at
  once when rungs outrun the last reading (a recovery) or a segment takes 80% of its own length to
  arrive (a drop), never closer than 8s apart.
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
- **Startup cushion**: a session asks for 12s of forward buffer (two rung segments, which ride
  out the server encoder's warm-up). Handed back to AVPlayer the moment the picture is up. Holding it for the whole session costs what it buys: a 30 to
  1.5 Mb/s drop found 6s buffered and stalled 37s.
- **Chapter pictures** made on the device wait for a link measured to carry the copy with the
  master's margin (`linkAffordsChapterFrames`). The gate used to be "a ladder is listed", which is
  true of every eligible session, so no streamed file ever got a picture.
- The session's audio and subtitle tracks survive every step, including the
  hand-over to the server: AVPlayer's own auto-selection is not read as the
  viewer's choice, and a rebuilt stream re-applies the viewer's track by position on the FIRST
  report of its manifest only (`freshManifest`): any later report is the viewer moving, and
  re-applying there pushed them back. A track the viewer chose no longer narrows the server lane
  to that one track (`serverLaneCarriesEveryTrack`), and the multi-audio stream opens at the
  preset the measured link carries.

## Segments and the grid

- The grid is the SERVER'S segment list, adopted from the canonical rung's
  playlist: Jellyfin cuts at the source's keyframes, ignores the requested
  SegmentLength, and cold random access is byte-identical (16/16 in
  `scripts/probe-slipstream.mjs`, which is kept for re-proving that against a
  hardware-encoder server). Stream copy cuts at those same keyframes, so both
  variants are IDR-aligned by construction.
- Only the canonical rung's playlist is fetched before the master. Every other rung is listed
  unfetched and adopted when AVPlayer asks for it (`adoptRung`): each playlist is 48 KB, and two
  of them are 1.3s of a 0.6 Mb/s first frame. One cut on another grid is retired then and answers
  404, which AVPlayer steps over (measured: -12938 in its error log, the next rung played, no stall).
- Rung 0's opening segment is ONE transfer (`TierSegmentFetch`): the init is cut from its first
  64 KB the moment they land, the segment is written when the rest arrives, and the player's own
  requests wait on it. Its init is held up to 4s for the segment, because AVPlayer starts on one
  segment that arrives at once and waits for two when it watches one download; 4s keeps clear of
  the 6s it allows a map request (-12889 "No response for map", measured at 0.6 Mb/s).
- A rung or audio-lo segment is fetched whole before it can be sent, so its response leads with
  the segment's own `styp` box and pads with empty `free` boxes every 2s until the body is ready.
  AVPlayer fails a segment it hears nothing from in 6s, which is what made every rung above the
  opening one unusable at 750 kb/s (-12889 on each attempt, then back to t0).
- The rung lane is NOT read ahead. Tried and measured: segments that arrive instantly make
  AVPlayer climb on a thin buffer and stall (15s, 21s and 7s across three links). Its own clock on
  segments fetched as it asks is what keeps a thin link smooth.
- The audio-lo init is fetched once a session, not once a segment.
- A request more than 2 segments ahead of the producer is a seek (`seekAheadSegments`), whatever
  the read-ahead depth. It used to be the 20-segment window, so a rebuild or a resume inside a
  film's first two minutes waited for every segment between to be pulled at link speed (measured:
  13.8s for a rebuild at 63s on a 30 Mb/s link, 3s after).
- A copy segment's response leads and pads the same way: it is megabytes, and on a link that only
  just carries it the whole of one takes most of the 6s AVPlayer allows a silent response.
- Starting on a rung holds the engine's source pull, so the slow link goes
  wholly to the server renditions; any copy request resumes it.
- A session riding a rung serves the SERVER's WebVTT for text subtitles: the
  engine's own cues come from a source pull that is being held, and AVPlayer
  drops the item if a subtitle window misses its 6s deadline. Server cues are session time as
  they arrive: Jellyfin extracts without `-copyts`, so they count from the file's start (measured
  with its own ffmpeg and command line: pts 7.0 in a source starting at 5.0 extracts at 00:00:02).

## The acceptance matrix (scripts/abr-drill.mjs)

`scripts/netsim-proxy.mjs` shapes one token bucket in front of Jellyfin; the
drill plays a fixture through it and scores the timeline
(`scripts/lib/abr-score.mjs`).

| Scenario | Link                              | Asserts                                     |
| -------- | --------------------------------- | ------------------------------------------- |
| S1       | unthrottled                       | opens on the copy and stays there           |
| S2       | 1.5 Mb/s                          | opens on a rung, no stall                   |
| S3       | 30 → 1.5 at 60s                   | steps down, no stall                        |
| S4       | 1.5 → 30 at 60s                   | climbs back to the copy                     |
| S5       | 0.6 Mb/s                          | plays at all, no stall                      |
| S6       | 3 ↔ 6 every 20s                   | does not flap                               |
| S7       | down then up, two audio tracks    | steps down, climbs back, keeps both tracks  |
| S8       | rung playlists refused            | survives by handing over to the server      |
| S9       | 750 kb/s, 150 ms round trip       | the slow-start gate; rides a rung, no stall |
| S10      | 12 Mb/s, 40 ms round trip         | opens at 480p, ends on the copy (150s run)  |
| S11      | the source refused outright       | the rungs carry the session, no rebuild     |
| S12      | 1.5 Mb/s, one rung's playlist 404 | the ladder goes on without it               |

Every scenario also asserts: a first frame inside 4.5s on a fast link and 8s on a slow one, no
stall, no player item replaced (S4 is allowed its one rebuild, S8 its one hand-over), playback to
the end of the run, and every audio and subtitle track still listed. On every steady stretch of a
profile (60s or more) it asserts what the engine owes and what AVPlayer does with it, apart:

- **offers**: the variant the link carries (the copy past `source * 1.2`, else the biggest rung
  inside 0.8 of the link) is named in the master AND inside the cap in force. That part is ours.
- **rides**: AVPlayer's standing choice is never under what HALF the link carries, and is the
  copy whenever the copy is what the link deserves. How high it climbs above that is its own
  call on its own clock, and on a thin link a careful one.
- **opens at**: thirty seconds in, the picture is at least the rung the engine opens that link on.
- **holds steady**: at most one correction of picture size after 45s. A step away and back is
  one. Requests are ordered by when AVPlayer ASKED: they are stamped when they end, and a segment
  that took 20s to die after a drop otherwise reads as a switch made 20s later.

S7's thin stretch is 150s, not 300: AVPlayer buffers a 240p rung several times faster than it
plays, had all of a 12-minute fixture by 341s, and a file it has all of is never re-evaluated.

The copy's start at 30 Mb/s is 2.6s or 3.6s on identical engine timings (first segment complete at
1.9s in every run): fifteen runs at a 6, 4 and 2s forward buffer split the same way, so the second
is AVPlayer's own and the buffer is not the lever.

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
