# Playback Regression Suite

Plays real media through the real app on a simulator, exactly like production playback: deep link into the player, real Jellyfin server, real on-device remux engine. Detects three regression classes:

1. **Wrong playback path**: the state machine must choose the manifest's expected mode (`direct` / `localRemux` / `transcode`), and a localRemux item silently falling back to server transcode fails even when playback looks fine on screen.
2. **Broken playback**: position must advance past `progressMin` with no error events.
3. **Changed remux output**: the engine's loopback HLS is hashed by host ffmpeg against committed baselines. Stream-copied video compares exact packet hashes (which embed PTS, so timeline and subtitle-sync shifts diff). Device-transcoded video and re-encoded AAC compare stream layout, frame counts, and durations with tolerances, since those encodes are not bit-exact.

```
npm run test:playback                        # all items, needs one booted simulator
npm run test:playback -- --only T05,T07      # subset (also forces manifest-skipped items)
npm run test:playback -- --update-baselines  # rewrite baselines from a KNOWN-GOOD build
npm run test:playback -- --udid <UDID>       # target and boot a specific simulator
npm run test:playback -- --list              # print the manifest and exit
```

## First-time setup

```bash
cp /dev/null .env.playback-test   # then fill in JELLYFIN_URL and JELLYFIN_API_KEY (below)
npm run make:test-media -- --with-library   # builds the media set, registers the libraries
npm run test:playback
```

`scripts/make-test-media.mjs` rebuilds the surround/lossless half of the set from
nothing: it generates the synthetic matrix with Jellyfin's bundled ffmpeg, downloads
the real-encoder samples it cannot synthesise and, only under `--with-library`,
registers the three Jellyfin libraries and attaches posters over the API. That step
is opt-in because it mutates whatever server `.env.playback-test` points at, which is
somebody's personal one. It is idempotent, so re-running it only fills gaps.
Source URLs and checksums for every downloaded file are recorded in
`test/playback/media-sources.json`.

## Assumptions the suite depends on (read this when lost)

**Test media lives OUTSIDE the repo**, flat, named `T<NN> <PATH> <detail>.<ext>`, in
three folders. These three paths are the fixture roots the driver anchors on:

| Folder                          | Contents                                      |
| ------------------------------- | --------------------------------------------- |
| `~/Movies/development-videos/`  | every video fixture, T01-T45, T60-T102        |
| `~/Music/Development Audio/`    | the stereo audio-only items T50-T55           |
| `~/Music/Development Surround/` | the surround audio-only items T56 and T70-T73 |

The video folder is `development-videos`, not `Development Videos`: a second
directory of the same fixtures under the older name held copies of T07/T08/T11 with
different durations, so a title resolved to either file at random. Both were merged
here on 2026-08-12. The pre-merge originals are gone: the backup that held them no
longer exists, so a fixture's original filename is not recoverable.

Only titles and tiny JSON baselines are in git. The T01-T44 originals came from
Blender open movies and the IETF Matroska test files (see memories/CLAUDE-testing.md,
Manual Testing Videos) and are **not** regenerable by script; everything from T60 up
is, via `npm run make:test-media`. Per-fixture origin is recorded in
[`provenance.json`](./provenance.json).

**A Jellyfin server must be running and indexing those folders.** Which library
holds them does not matter, and neither do their names. The driver resolves a
manifest title only against items whose own directory is one of the three roots
above, overridable with `JELLYFIN_FIXTURE_ROOTS` in `.env.playback-test`.

Anchoring on the path is what survives a misconfigured server. Jellyfin attributes
a file to the top-level physical folder that owns it, so a library nested inside
another indexes empty, and two libraries over one path answer the same item ids:
library names are not a scope any client can rely on. A copy of a fixture outside
the roots (a staging tree, say) is ignored rather than resolving at random, and
two files sharing a title _inside_ a root still fail the run loudly.

`npm run make:test-media -- --with-library` registers the three named libraries
for convenience. It is not a prerequisite, and on a server whose libraries already
cover `~/Movies` and `~/Music` those libraries will index empty.

The driver triggers `/Library/Refresh` and resolves manifest titles to item ids fresh
every run, matching by item Name or by file-path basename, so nothing about ids is
stored anywhere and server rescans or database rebuilds are harmless.

**Posters go through the API, not the media folder.** A sibling `<name>-poster.jpg`
also lands as its own item in a library that accepts photos. The older items still do
it the file way and carry that clutter; the generator uploads to
`/Items/{id}/Images/Primary` instead.

**`.env.playback-test`** (repo root, gitignored, never commit) must exist:

```
JELLYFIN_URL=http://localhost:8096
JELLYFIN_API_KEY=<Dashboard -> Advanced -> API Keys>
# optional: BUNDLE_ID=dev.keiver.tomotv
# optional: JELLYFIN_USER=<name> and JELLYFIN_PASSWORD=<pw>, the run signs the app in itself (dev builds)
```

The key is also used to reset each item's resume position before launch, for every user on the server, so every run starts at 0; without that, resume carries across runs and the hash window starts past seg0.

**The app on the simulator must be signed in to the SAME server** `JELLYFIN_URL` points at. With `JELLYFIN_USER` and `JELLYFIN_PASSWORD` set the suite signs a dev build in itself after the prewarm launch, through the `tomotv://dev-session` link (`app/dev-session.tsx`, `__DEV__` only). Without them the app keeps its own SecureStore credentials. If the app is signed into a different server (e.g. the LAN IP of the same machine, which is fine) the item ids still match because it is the same server database. Signed out, or signed into a genuinely different server, every item fails with "no probe events" or metadata errors.

**A dev build needs Metro.** Run `npm start` first; the suite prewarms the app once per run so the first item does not eat the JS bundle download. The app must be installed on the target simulator (`npm run ios` / `npm run both`).

The prewarm does not cover a COLD bundle for a platform Metro has not built yet. The first iOS run after a tvOS run pays a full iOS bundle build, the deep link is served minutes late, and every item reads "no probe events" while the app is in fact playing correctly. Check the probe file's timestamps against the run: events arriving after the driver gave up is the signature. Run one item first (`--only T01`) to warm the platform, then start the suite.

**Host tools:** `ffmpeg`/`ffprobe` on PATH (`brew install ffmpeg`), Xcode simctl. Host-side validation works because the simulator shares the Mac's network stack, so the engine's `127.0.0.1:<port>` HLS server is reachable from the terminal. This does NOT hold for a physical device; on-device runs get mode and progress assertions only unless validation is reworked.

## How one item runs

1. Force-quit the app, reset the item's resume position via the API.
2. `xcrun simctl openurl <sim> "tomotv://player?videoId=<id>&probe=1"` cold-starts the app straight into the real player screen, which autoplays.
3. `services/playbackProbe.ts` (armed ONLY by `probe=1` and `__DEV__`, inert otherwise) appends events to `Library/Caches/playback-probe.jsonl` in the app container: chosen mode, stream URL, errors, retries, positions. The driver polls it via `simctl get_app_container`.
4. After the play window, with the app still alive so the remux session survives, the driver ffprobes the loopback master playlist and hashes the first 30s, then compares against `baselines/<TNN>.json`.
5. Force-quit, next item.

## Manifest fields (`manifest.json`)

- `title`: Jellyfin item name = filename without extension. The contract between repo and media folder; rename a file and this must follow (the item also gets a new id, which is fine).
- `mode`: expected playback mode. `allowRetry` + `finalMode`: for items whose real-world behavior is a legitimate auto-retry (T54: AVPlayer has no Ogg demuxer, direct fails, app retries with transcode).
- `validate`: `copy` (exact video packet hashes), `devtc` (tolerant, VideoToolbox re-encode), `subsync` (server-HLS subtitle-sync invariant, see below), `live` (the engine's live window, see the Live TV rig below), `none` (mode + progress only).
- `expect`: post-remux stream layout (codecs, subtitle rendition count, audio rendition count, VIDEO-RANGE). Live items: `audioTracks` (renditions the master must offer) and `discontinuity` (an `EXT-X-DISCONTINUITY` must be in the window after the play).
- `expect.tierVariant`: whether the master offers Slipstream rungs (`t0.m3u8` and up). True for an SDR file with audio played from the server, false for an item the ladder excludes (HDR, live, audio-only). When true the driver also checks the shape a switch depends on: the copy listed beside the rungs on this fast LAN, one subtitle group across every variant, `audio-lo` on the rungs, and ascending BANDWIDTHs that count their audio group.
- `live`: a Live TV channel, resolved by name from `/LiveTv/Channels` instead of from the fixture roots.
- `skip`: known limitation; skipped unless named in `--only`. Currently T10 (simulator rejects HDR PQ) and T32, T36, T41 (the simulator has no HEVC encoder); verify them on a device.
- `playSeconds` / `progressMin`: play window and minimum position, lowered for short files.

## Known issues

- **T31 hash validation is off.** A tiny file's device transcode reaches EOF in seconds and the 20-segment window evicts the head. An out-of-window request queues a seek-restart rather than a 404, so validation is likely liftable; it needs a fixture that plays past the window and seeks back, which the driver cannot express yet.
- **T10 HEVC HDR10 PQ fails on the tvOS simulator** (NSURLError -1002 on the PQ master, and the server HDR transcode also fails there). The PQ path was built against real-device behavior; needs a device run.
- **Filename misnomers**: T05's audio is DTS 5.1 (not TrueHD); T27's VC1 file has no audio stream at all. Left as-is because renaming re-creates the Jellyfin items.
- **E-AC-3 7.1 cannot be generated.** FFmpeg's `eac3` encoder tops out at 5.1 and silently downmixes, so the 8-channel E-AC-3 case comes from the real `7_pt_1.eac3` sample (T80). T62 carries the synthetic 8-channel case as FLAC instead.

## T44: the server-HLS subtitle-sync guard (`validate: "subsync"`)

Jellyfin stamps every HLS WebVTT segment with `X-TIMESTAMP-MAP=MPEGTS:900000` (10s). Players apply that map against the media segments' internal PTS base: MPEG-TS segments start at ~10s (delta 0, in sync), fMP4 segments start at 0 (every cue 10s late, the 2026-08-10 Star Trek bug). `getTranscodingStreamUrl` therefore requests `SegmentContainer=ts` whenever text renditions ride. T44 pins that forever: its video is ASUS V1 (`asv1`), a codec outside `TRANSCODABLE_VIDEO_CODECS`, so `video codec unsupported` holds it on the server lane whatever size or hardware is in play, and its embedded SRT forces WebVTT renditions. `services/__tests__/localRemux.test.ts` pins that decline, so growing the allowlist fails there instead of retiring this guard in silence. The title still says Theora because it must match the file on disk. The driver fetches the master the app actually played, and fails on: no subtitle rendition, segments not mpegts, or `|map − first segment PTS| > 0.5s`.

The video carries a burned-in clock and every cue echoes it ("IN SYNC if clock reads 00:00:14 - 00:00:16"), so on a physical device, where host-side validation cannot reach the stream, sync is verifiable by eye, including after seeks.

The current file was made from the previous Theora fixture by re-encoding the video alone, audio and subtitles copied (the original is in `~/backup/subsync-fixtures-*`):

```bash
"/Applications/Jellyfin.app/Contents/MacOS/ffmpeg" -i "$BACKUP/T44 SERVER Theora SRT subsync.mkv" -map 0 -vf scale=1280:720 -c:v asv1 -q:v 12 -c:a copy -c:s copy \
  "$HOME/Movies/development-videos/T44 SERVER Theora SRT subsync.mkv"
```

Regenerate from nothing if the media folder is lost (Jellyfin's ffmpeg has the `asv1` encoder):

```bash
python3 -c "
lines = []
for i in range(45):
    a, b = i * 2, i * 2 + 2
    fmt = lambda s: f'00:{s // 60:02d}:{s % 60:02d}'
    lines += [f'{i + 1}', f'{fmt(a)},000 --> {fmt(b)},000', f'IN SYNC if clock reads {fmt(a)} - {fmt(b)}', '']
open('t44.srt', 'w').write('\n'.join(lines))
"
"/Applications/Jellyfin.app/Contents/MacOS/ffmpeg" \
  -f lavfi -i "testsrc2=size=640x360:rate=24:duration=90" \
  -f lavfi -i "sine=frequency=440:duration=90" -i t44.srt \
  -map 0:v -map 1:a -map 2:s \
  -vf "drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='%{pts\:hms}':fontsize=56:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=12:x=(w-text_w)/2:y=48" \
  -c:v asv1 -q:v 12 -c:a aac -b:a 96k -c:s srt -metadata:s:s:0 language=eng \
  "$HOME/Movies/development-videos/T44 SERVER Theora SRT subsync.mkv"
```

### T45: the same guard on real content

T44's clock proves the timing mechanically but nobody can judge "does this look right" against a colour-bar pattern. T45 is a 90-second dialogue clip from a broadcast episode carrying its real English SDH track, with the video re-encoded to ASUS V1 (`asv1`) at 1280x960, so `canRemuxLocally` declines it as `video codec unsupported` and the item cannot drift onto the engine lane. The title still says DivX3 because it must match the file on disk. Same `subsync` validation; play it on a device to judge cue timing against actual speech.

Regenerate (the window is the densest 90s of dialogue in that episode; any dialogue-heavy source works):

```bash
SRC="$HOME/Movies/Star.Trek.Strange.New.Worlds.S04E01.480p.x264-mSD[EZTVx.to].mkv"
FF="/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
"$FF" -ss 1065 -t 90 -i "$SRC" -map 0:v:0 -map 0:a:0 -vf scale=1280:960 -c:v asv1 -q:v 10 -c:a copy t45_av.mkv
"$FF" -ss 1065 -t 90 -i "$SRC" -map 0:s:0 -c:s srt t45_subs.srt   # -t does NOT clamp subs
# keep only cues starting before 89s and renumber them, then:
"$FF" -i t45_av.mkv -i t45_trimmed.srt -map 0:v -map 0:a -map 1:s -c copy \
  -metadata:s:s:0 language=eng -metadata:s:s:0 title="English SDH" \
  "$HOME/Movies/development-videos/T45 SERVER DivX3 SDH subsync.mkv"
```

The current file was made from the previous DivX3 fixture the same way T44 was: `-map 0 -vf scale=1280:960 -c:v asv1 -q:v 10 -c:a copy -c:s copy`.

## The engine decides by doing (T40, and the verdict file)

There is no size gate on the engine lane. The engine times segment 0 before the player is bound
and the player takes the server lane when that segment ran below realtime (`fallback` event,
reason `engine below realtime`, no `error`, no restart), then remembers the file in
`engine-verdicts.json` (`services/engineVerdicts.ts`; `Documents/` on iOS, `Library/Caches/` on tvOS). T40, the 8K VP9, is the item
that exercises it: `mode: localRemux`, `allowRetry: true`, `finalMode: transcode`. On the
simulator the software encoder opens and the pre-flight moves it; on a device the encoder
refuses 8K and the start-time fallback lands in the same place.

The driver deletes the verdict file from the app container before every item, the way it deletes
the probe file, so a verdict from an earlier run cannot change the first mode the manifest
asserts. On a device the file persists: a second play of a remembered item chooses `transcode` at
the lane pick, which Diagnostics shows as a decline with reason `engine below realtime on an
earlier play`.

## Transcode bench (`npm run bench:transcode`)

Measures the software-decode + VideoToolbox lane on the hardware it runs on: the record behind
the design above, and the way to see where any device stands. The driver
(`scripts/transcode-bench.mjs`) opens `tomotv://dev-bench` (`app/dev-bench.tsx`, dev builds
only); the app runs each rung through `VideoTranscoder.benchmark()` for a wall-clock window,
looping the file at EOF, once decode + encode and once decode only, and writes
`Library/Caches/transcode-bench.json`, which the driver polls and prints.

```
npm run make:test-media -- --bench                     B01-B09 and B12, scaled from the T40 8K source (minutes per 4K rung)
npm run bench:transcode                                booted simulator: proves the tooling, the decoders run on this Mac
npm run bench:transcode -- --device "Main Bedroom"     paired device by devicectl name; the numbers on real hardware
npm run bench:transcode -- --only B03,B07 --seconds 45 --no-decode
```

Rungs: T21 (the 2048x858 file behind the original 7.63x figure), B01-B04 VP9 at 1080p, 1440p,
2160p and 2160p 10-bit, B05-B08 the same ladder in AV1, B09 MPEG-2 1080i for the bwdif pass, B12
VP9 4K at 60 fps (the 24 fps source resampled: a file a device may fail the pre-flight on), and
T40, the 8K VP9. Each row reports the realtime factor for both passes, fps per 10 s window (a
falling series is the thermal story), thermal state before and after, the conversion path taken
and the decoder name. Records land in `test/playback/bench/<device>-<date>.json`.

A device keeps its own account and must be signed in to the server `JELLYFIN_URL` names, since
the driver resolves the rung ids there. `devicectl` is called at its Xcode path because
`xcode-select` on the dev Mac points at CommandLineTools.

## Slipstream drill (`scripts/abr-drill.mjs`, T101 and T102)

The suite plays on a LAN that carries everything, so it proves the master's
SHAPE but never the switching. The drill does the switching: `scripts/netsim-proxy.mjs`
puts one shaped token bucket in front of Jellyfin (no sudo, both directions,
timed profiles over `POST /__netsim`), and the drill plays a 12 minute fixture
through it, then scores the timeline with `scripts/lib/abr-score.mjs`.

```bash
node scripts/abr-drill.mjs --host                  # macOS AVPlayer against the real engine
node scripts/abr-drill.mjs --device "Main Bedroom" --lan-host "$(ipconfig getifaddr en0)"
node scripts/abr-drill.mjs --udid <simulator-UDID> # the real app, not a hardware acceptance gate
#  --items T101,T102  --scenarios S1,S4  --link 1500000  --buffer 12  --start 0  --no-window
```

The scenarios in `scripts/lib/abr-score.mjs` cover steady links, network steps,
latency, and refused routes. No scenario allows a player replacement, including
recovery and fallback. The app reports display readiness separately from progress
and records audio/subtitle catalogues through transitions. Request logs describe
transfers, not displayed frames; quality assertions still need presentation-level
evidence before these results can be a release gate. Simulator results never
replace the physical Apple TV matrix. Results append to `$TMPDIR/tomotv-drill/drill-results.md`
with each run's timeline, proxy log and engine log beside them.

The host path captures the app's real bridge config through
`test/playback/drill/engineConfig.drill.test.ts` and plays it in
`SlipstreamDrillTests`; the device path signs the TV into the proxy with
`tomotv://dev-session`, plays through the app itself, and restores the TV to
the LAN address afterwards. It clears the fixture's resume point per run, and
refuses to start if a proxy from an earlier run still holds the port.

## Live TV rig (`L` items, `validate: "live"`)

A channel is not a file, so the `L` items run against a throwaway Jellyfin 12 in Docker with an
M3U tuner (`live/live.m3u`) whose channels are looped MPEG-TS sources served inside the container.
The spliced channel needs `live/rawstream.py`, a raw paced streamer: `ffmpeg -c copy` rewrites
non-monotonic DTS and erases the PTS splice the item exists to exercise. Point `JELLYFIN_URL` at
the rig (port 8098) and sign the app into it.

```
# the server, with the fixtures and the tuner files mounted
docker run -d --name tomo-livetv-probe -p 8098:8096 -v "$PWD/test/playback/live:/tuner:ro" \
  -v "$HOME/Movies/development-videos:/fixtures:ro" -v tomo-livetv-config:/config jellyfin/jellyfin:12.0
# finish the wizard, add an M3U tuner with Url /tuner/live.m3u and an XMLTV listing at /tuner/guide.xml,
# then refresh the guide. Channel logos (tvg-logo) and programme posters (XMLTV icons) come from
# the HLS web server below; the server fetches them on its own loopback and serves them to the app
python3 test/playback/live/make-guide.py --tuner test/playback/live --art test/playback/live/hls

# three looped channels, each a single-client ffmpeg server inside the container
docker exec -d tomo-livetv-probe sh -c 'while true; do /usr/lib/jellyfin-ffmpeg/ffmpeg -nostdin -loglevel error -re -stream_loop -1 \
  -i "/fixtures/T24 DEVTC MPEG2 MP2 TS.ts" -map 0:v:0 -map 0:a:0 -c copy -f mpegts -listen 1 http://127.0.0.1:9101/live.ts; sleep 1; done'
docker exec -d tomo-livetv-probe sh -c 'while true; do /usr/lib/jellyfin-ffmpeg/ffmpeg -nostdin -loglevel error -re -stream_loop -1 \
  -i "/fixtures/T07 REMUX H264 AC3 embedded-subs.mkv" -map 0:v:0 -map 0:a:0 -c copy -f mpegts -listen 1 http://127.0.0.1:9102/live.ts; sleep 1; done'
docker exec -d tomo-livetv-probe sh -c 'while true; do /usr/lib/jellyfin-ffmpeg/ffmpeg -nostdin -loglevel error -re -stream_loop -1 \
  -i "/fixtures/T09 REMUX multi-audio.mkv" -map 0:v:0 -map 0:a -c copy -f mpegts -listen 1 http://127.0.0.1:9103/live.ts; sleep 1; done'

# the spliced source: T24 at 40-70s, then 0-30s, same PIDs, one backward PTS step per pass
F="$HOME/Movies/development-videos/T24 DEVTC MPEG2 MP2 TS.ts"
ffmpeg -y -i "$F" -t 30 -map 0:v:0 -map 0:a:0 -c copy -output_ts_offset 40 -f mpegts test/playback/live/a.ts
ffmpeg -y -i "$F" -t 30 -map 0:v:0 -map 0:a:0 -c copy -copyts -mpegts_copyts 1 -f mpegts test/playback/live/b.ts
cat test/playback/live/a.ts test/playback/live/b.ts > test/playback/live/splice.ts
# paced at the source's own rate (ffprobe bit_rate of the halves, ~4.0 Mbps); slower starves the engine
docker run -d --name tomo-rawstream --network container:tomo-livetv-probe -v "$PWD/test/playback/live:/tuner:ro" \
  python:3-alpine python3 /tuner/rawstream.py /tuner/splice.ts 9105 4200000

# the HLS channel (L05): T07 looped into a live HLS playlist, served on the server's loopback and on the
# Mac's, same directory, so the tuner entry http://127.0.0.1:9109/live.m3u8 resolves for both. The
# server never marks a manifest direct play and the engine reads the origin itself, which is why the
# simulator must reach the origin too (a device cannot; L05 is simulator only)
mkdir -p test/playback/live/hls
docker run -d --name tomo-hls-enc -v "$HOME/Movies/development-videos:/fixtures:ro" -v "$PWD/test/playback/live/hls:/hls" \
  --entrypoint /usr/lib/jellyfin-ffmpeg/ffmpeg jellyfin/jellyfin:12.0 -hide_banner -loglevel warning -re -stream_loop -1 \
  -i "/fixtures/T07 REMUX H264 AC3 embedded-subs.mkv" -map 0:v:0 -map 0:a:0 -c copy -f hls -hls_time 4 -hls_list_size 8 \
  -hls_flags delete_segments -hls_segment_filename /hls/seg%05d.ts /hls/live.m3u8
docker run -d --name tomo-hls-web --network container:tomo-livetv-probe -v "$PWD/test/playback/live/hls:/hls:ro" \
  python:3-alpine python3 -m http.server 9109 --directory /hls
docker run -d --name tomo-hls-web-host -p 127.0.0.1:9109:9109 -v "$PWD/test/playback/live/hls:/hls:ro" \
  python:3-alpine python3 -m http.server 9109 --directory /hls
```

The engine package's `LivePipelineTests` read the same sources without Jellyfin: publish them on
the Mac loopback (`-p 127.0.0.1:9106:9106 ... 9106 4200000 0.0.0.0`, and cuts of T07 and T09 to
MPEG-TS on 9107 and 9108 the same way) and run
`TOMO_LIVE_SOURCE=http://127.0.0.1:9106/live.ts TOMO_LIVE_SOURCE_H264=http://127.0.0.1:9107/live.ts TOMO_LIVE_SOURCE_MULTI=http://127.0.0.1:9108/live.ts npm run test:engine`.
`TOMO_LIVE_SOURCE_H264` also takes the HLS origin (`http://127.0.0.1:9109/live.m3u8`) or any live HLS URL.

`TOMO_LIVE_SOURCE_LONGGOP` runs `testALongGopCopySourceCutsOnKeyframesNotAtTheTarget`: a copy
source whose keyframe interval is far longer than the segment target, proving each live segment
opens on a keyframe (one GOP long) rather than being force-cut mid-GOP. Make one with a ~10s GOP
and serve it on the loopback:

```
ffmpeg -y -i "$HOME/Movies/development-videos/T07 REMUX H264 AC3 embedded-subs.mkv" -t 60 -map 0:v:0 -map 0:a:0 \
  -c:v libx264 -preset ultrafast -x264-params "keyint=250:min-keyint=250:scenecut=0" -c:a aac -f mpegts live/longgop.ts
python3 live/rawstream.py live/longgop.ts 9110 3200000 127.0.0.1
TOMO_LIVE_SOURCE_LONGGOP=http://127.0.0.1:9110/live.ts npm run test:engine
```

`TOMO_LIVE_SOURCE_CC` is a copied H.264 source with CEA-608 captions in its SEI: Apple's bipbop
sample segments, concatenated and looped. `testACaptionedCopySourceDeclaresAndCarriesClosedCaptions`
checks the master declares the caption group and that ffmpeg's subcc extractor still finds cues in
the copied fMP4 segments. `TOMO_LIVE_SOURCE_DVB` is T43's PGS track re-encoded to dvbsub (bitmap
to bitmap) in a looped TS; `testADvbSubtitleCopySourceServesLiveCues` checks the rendition, its
sliding playlist, and the decoded cues on the output timeline. Pace both at their own bit rate:

```
for i in $(seq 0 9); do curl -s -o live/bb$i.ts https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/gear1/fileSequence$i.ts; done
cat live/bb?.ts > live/bipbop-cc.ts
ffmpeg -y -stream_loop 5 -i "$HOME/Movies/development-videos/T43 SERVER H264 PGS short.mkv" -map 0:v:0 -map 0:s:0 -c:v copy -c:s dvbsub -f mpegts live/dvb-live.ts
python3 live/rawstream.py live/bipbop-cc.ts 9111 260000 127.0.0.1
python3 live/rawstream.py live/dvb-live.ts 9112 90000 127.0.0.1
TOMO_LIVE_SOURCE_CC=http://127.0.0.1:9111/live.ts TOMO_LIVE_SOURCE_DVB=http://127.0.0.1:9112/live.ts npm run test:engine
```

`TOMO_LIVE_SOURCE_TELETEXT` is FFmpeg's teletext sample (dvb_teletext at index 3, Italian and
English subtitle pages); `TOMO_LIVE_SOURCE_DASH` is any live MPD:

```
curl -o live/teletextsubtitles.ts http://samples.ffmpeg.org/ffmpeg-bugs/trac/ticket2086/teletextsubtitles.ts
python3 live/rawstream.py live/teletextsubtitles.ts 9113 14921012 127.0.0.1
TOMO_LIVE_SOURCE_TELETEXT=http://127.0.0.1:9113/live.ts TOMO_LIVE_SOURCE_DASH=https://livesim2.dashif.org/livesim2/testpic_2s/Manifest.mpd npm run test:engine
```

`LiveAVPlayerTests` plays the same sessions through the Mac's own AVPlayer over the loopback
server, routed the way the app routes: keyframe-cut long-GOP segments play, the declared caption
group shows up as a closed-caption legible option, and a pause longer than the live window (16s
in the test) is followed by playback going on. The last one logs what the player did; read it.

The server rung below the engine on live (`liveTranscodeUrl`, Jellyfin's live HLS transcode) has its
own opt-in: open a channel with `PlaybackInfo` (`EnableTranscoding: true`, one `ts`/`hls` transcoding
profile) and hand the `TranscodingUrl` it returns to the same harness. Close the live stream after.

```bash
TOMO_LIVE_SERVER_MASTER="http://127.0.0.1:8096/videos/<id>/master.m3u8?...&LiveStreamId=..." npm run test:engine -- --filter LiveAVPlayerTests/testAVPlayerPlaysTheServerLiveMaster
```

Measured on Jellyfin 12.0: an fMP4 (`mp4`) live transcoding profile is ignored and the reply degrades to
a progressive `/stream` URL, so the profile is TS; HEVC copied into TS plays in AVPlayer.

## Regenerating baselines

Only from a build you trust: `npm run test:playback -- --update-baselines`. Baselines are per-machine-class stable (H.264/HEVC decode is spec-exact; packet hashes are copy-exact) and were recorded on the tvOS simulator against the FFmpeg build `scripts/ffmpeg/ffmpeg-lock.json` pins; an FFmpeg bump that changes muxing is EXPECTED to diff the copy hashes, and that diff is the review signal, not noise to be blindly regenerated away.

The digest covers the `framemd5` header, which carries the HOST ffmpeg's `#software: Lavf<version>`, so upgrading brew's ffmpeg diffs every copy baseline on its own. Separate that from a real change by comparing the hash column of the engine's master and the source file, hashed by the same ffmpeg.
