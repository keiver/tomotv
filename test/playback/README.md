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
npm run make:test-media           # builds the media set and registers the libraries
npm run test:playback
```

`scripts/make-test-media.mjs` rebuilds the surround/lossless half of the set from
nothing: it generates the synthetic matrix with Jellyfin's bundled ffmpeg, downloads
the real-encoder samples it cannot synthesise, registers the Jellyfin library, and
attaches posters over the API. It is idempotent, so re-running it only fills gaps.
Source URLs and checksums for every downloaded file are recorded in
`test/playback/media-sources.json`.

## Assumptions the suite depends on (read this when lost)

**Test media lives OUTSIDE the repo**, flat, named `T<NN> <PATH> <detail>.<ext>`, in
three folders:

| Folder                          | Contents                                                   |
| ------------------------------- | ---------------------------------------------------------- |
| `~/Movies/Development Videos/`  | the codec matrix, T01-T44, plus the surround items T60-T88 |
| `~/Music/Development Audio/`    | the audio-only items T50-T55                               |
| `~/Music/Development Surround/` | the lossless audio-only items T70-T73                      |

Only titles and tiny JSON baselines are in git. The T01-T44 originals came from
Blender open movies and the IETF Matroska test files (see memories/CLAUDE-testing.md,
Manual Testing Videos) and are **not** regenerable by script; everything from T60 up
is, via `npm run make:test-media`. The 2026-08-07 merge of the old
`codec-testing-tomotv` folder is recoverable from
`~/backup/test-library-merge-20260807-080642/`.

**A Jellyfin server must be running and indexing those folders.** The dev setup is
server "veguitas" at `http://localhost:8096` with three relevant libraries:

| Library                    | Type         | Path                           |
| -------------------------- | ------------ | ------------------------------ |
| `Development Videos`       | mixed (none) | `~/Movies/Development Videos`  |
| `Development Videos Audio` | music        | `~/Music/Development Audio`    |
| `Development Surround`     | music        | `~/Music/Development Surround` |

The driver triggers `/Library/Refresh` and resolves manifest titles to item ids fresh
every run, matching by item Name or by file-path basename, so nothing about ids is
stored anywhere and server rescans or database rebuilds are harmless.

**Posters go through the API, not the media folder.** `Development Videos` is a
mixed-content library, so a sibling `<name>-poster.jpg` also lands as its own Photo
item. The older items still do it the file way and carry that clutter; the generator
uploads to `/Items/{id}/Images/Primary` instead.

**`.env.playback-test`** (repo root, gitignored, never commit) must exist:

```
JELLYFIN_URL=http://localhost:8096
JELLYFIN_API_KEY=<Dashboard -> Advanced -> API Keys>
# optional: BUNDLE_ID=dev.keiver.tomotv
```

The key is also used to reset each item's resume position before launch (via the first admin user account) so every run starts at 0; without that, resume carries across runs and the hash window starts past seg0.

**The app on the simulator must already be signed in to the SAME server** `JELLYFIN_URL` points at. The suite never logs in; the app reads its own SecureStore credentials. If the app is signed into a different server (e.g. the LAN IP of the same machine, which is fine) the item ids still match because it is the same server database. Signed out, or signed into a genuinely different server, every item fails with "no probe events" or metadata errors.

**A dev build needs Metro.** Run `npm start` first; the suite prewarms the app once per run so the first item does not eat the JS bundle download. The app must be installed on the target simulator (`npm run ios` / `npm run both`). As of 2026-08-07 only the Apple TV 4K (3rd generation, tvOS 26.4) simulator has it installed.

**Host tools:** `ffmpeg`/`ffprobe` on PATH (`brew install ffmpeg`), Xcode simctl. Host-side validation works because the simulator shares the Mac's network stack, so the engine's `127.0.0.1:<port>` HLS server is reachable from the terminal. This does NOT hold for a physical device; on-device runs get mode and progress assertions only unless validation is reworked.

## How one item runs

1. Force-quit the app, reset the item's resume position via the API.
2. `xcrun simctl openurl <sim> "tomotv://player?videoId=<id>&probe=1"` cold-starts the app straight into the real player screen, which autoplays.
3. `services/playbackProbe.ts` (armed ONLY by `probe=1` and `__DEV__`, inert otherwise) appends events to `Documents/playback-probe.jsonl` in the app container: chosen mode, stream URL, errors, retries, positions. The driver polls it via `simctl get_app_container`.
4. After the play window, with the app still alive so the remux session survives, the driver ffprobes the loopback master playlist and hashes the first 30s, then compares against `baselines/<TNN>.json`.
5. Force-quit, next item.

## Manifest fields (`manifest.json`)

- `title`: Jellyfin item name = filename without extension. The contract between repo and media folder; rename a file and this must follow (the item also gets a new id, which is fine).
- `mode`: expected playback mode. `allowRetry` + `finalMode`: for items whose real-world behavior is a legitimate auto-retry (T54: AVPlayer has no Ogg demuxer, direct fails, app retries with transcode).
- `validate`: `copy` (exact video packet hashes), `devtc` (tolerant, VideoToolbox re-encode), `subsync` (server-HLS subtitle-sync invariant, see below), `none` (mode + progress only).
- `expect`: post-remux stream layout (codecs, subtitle rendition count, audio rendition count, VIDEO-RANGE).
- `skip`: known limitation; skipped unless named in `--only`. Currently T10 (simulator rejects HDR PQ; verify on device).
- `playSeconds` / `progressMin`: play window and minimum position, lowered for short files.

## Known issues found by the suite (2026-08-07, still open)

- **Rolling-window eviction 404s** (T31): when the device transcode outruns playback (tiny files) or after a seek-restart, the 20-segment window evicts seg0 and `init.mp4` and the loopback server 404s them instead of regenerating. AVPlayer survives on cache; a back-seek into the evicted range would not. T31 hash validation is off until the engine regenerates on request. The same mechanism can make T20/T21 baselines flaky on faster hardware.
- **T10 HEVC HDR10 PQ fails on the tvOS simulator** (NSURLError -1002 on the PQ master, and the server HDR transcode also fails there). The PQ path was built against real-device behavior; needs a device run.
- **Filename misnomers**: T05's audio is DTS 5.1 (not TrueHD); T27's VC1 file has no audio stream at all. Left as-is because renaming re-creates the Jellyfin items.
- **Surround soundtracks must be video files.** `useVideoPlayback.ts` gates local remux on `!audioOnly`, so an audio-only item can never reach `AudioTranscoder`. That is why every T60-T88 soundtrack is muxed with a video track, and why the audio-only items in `Development Surround` (T70-T73) only exercise the direct/audio-player path.
- **PGS-only files never reach the engine.** `getBurnInSubtitleStream` returns a track whenever every subtitle stream is image-based, which makes `canRemuxLocally` decline and forces a full server transcode with `AllowVideoStreamCopy=false`. T85 and T86 are real Blu-ray extracts (TrueHD + AC-3 tracks + PGS, and DTS-HD MA + PGS) and demonstrate it. A file carrying any text subtitle track escapes, because mixed files only burn in a _forced image_ track.
- **E-AC-3 7.1 cannot be generated.** FFmpeg's `eac3` encoder tops out at 5.1 and silently downmixes, so the 8-channel E-AC-3 case comes from the real `7_pt_1.eac3` sample (T80). T62 carries the synthetic 8-channel case as FLAC instead.

## T44: the server-HLS subtitle-sync guard (`validate: "subsync"`)

Jellyfin stamps every HLS WebVTT segment with `X-TIMESTAMP-MAP=MPEGTS:900000` (10s). Players apply that map against the media segments' internal PTS base: MPEG-TS segments start at ~10s (delta 0, in sync), fMP4 segments start at 0 (every cue 10s late — the 2026-08-10 Star Trek bug). `getTranscodingStreamUrl` therefore requests `SegmentContainer=ts` whenever text renditions ride. T44 pins that forever: Theora has no decoder in the app's FFmpeg build (deliberate, see CLAUDE.md Known Issues), so the file can never take the on-device lane, and its embedded SRT forces WebVTT renditions. The driver fetches the master the app actually played, and fails on: no subtitle rendition, segments not mpegts, or `|map − first segment PTS| > 0.5s`.

The video carries a burned-in clock and every cue echoes it ("IN SYNC if clock reads 00:00:14 - 00:00:16"), so on a physical device — where host-side validation cannot reach the stream — sync is verifiable by eye, including after seeks.

Regenerate the asset if the media folder is lost (Jellyfin's ffmpeg has libtheora; Homebrew's does not):

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
  -c:v libtheora -q:v 6 -c:a aac -b:a 96k -c:s srt -metadata:s:s:0 language=eng \
  "$HOME/Movies/Development Videos/T44 SERVER Theora SRT subsync.mkv"
```

### T45: the same guard on real content

T44's clock proves the timing mechanically but nobody can judge "does this look right" against a colour-bar pattern. T45 is a 90-second dialogue clip from a broadcast episode carrying its real English SDH track, with the video re-encoded to DivX3 — `msmpeg4v3` has no registered decoder in the app's FFmpeg (deliberate, see `services/localRemux.ts`), so `canRemuxLocally` always declines it and the item can never drift onto the engine lane. Same `subsync` validation; play it on a device to judge cue timing against actual speech.

Regenerate (the window is the densest 90s of dialogue in that episode; any dialogue-heavy source works):

```bash
SRC="$HOME/Movies/Star.Trek.Strange.New.Worlds.S04E01.480p.x264-mSD[EZTVx.to].mkv"
FF="/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
"$FF" -ss 1065 -t 90 -i "$SRC" -map 0:v:0 -map 0:a:0 -c:v msmpeg4 -q:v 4 -c:a copy t45_av.mkv
"$FF" -ss 1065 -t 90 -i "$SRC" -map 0:s:0 -c:s srt t45_subs.srt   # -t does NOT clamp subs
# keep only cues starting before 89s and renumber them, then:
"$FF" -i t45_av.mkv -i t45_trimmed.srt -map 0:v -map 0:a -map 1:s -c copy \
  -metadata:s:s:0 language=eng -metadata:s:s:0 title="English SDH" \
  "$HOME/Movies/Development Videos/T45 SERVER DivX3 SDH subsync.mkv"
```

## Regenerating baselines

Only from a build you trust: `npm run test:playback -- --update-baselines`. Baselines are per-machine-class stable (H.264/HEVC decode is spec-exact; packet hashes are copy-exact) but were recorded on the tvOS 26.4 simulator with the MPVKit FFmpeg build pinned by `scripts/fetch-mpvkit.js`; an FFmpeg bump that changes muxing is EXPECTED to diff the copy hashes, and that diff is the review signal, not noise to be blindly regenerated away.
