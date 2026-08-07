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

## Assumptions the suite depends on (read this when lost)

**Test media lives OUTSIDE the repo** in `~/Movies/Development Videos/`, flat, named `T<NN> <PATH> <detail>.<ext>` (built 2026-08-07 by merging the old `codec-testing-tomotv` folder in; everything removed by that merge, including the originals of renamed files, is recoverable from `~/backup/test-library-merge-20260807-080642/`). Only titles and tiny JSON baselines are in git. If the media folder is lost, the suite is dead until an equivalent set is rebuilt; sources for most files are Blender open movies and the IETF Matroska test files (see memories/CLAUDE-testing.md, Manual Testing Videos).

**A Jellyfin server must be running and indexing that folder.** The dev setup is server "veguitas" at `http://localhost:8096`, whose "Movies" library (homevideos type) points at `~/Movies` and therefore indexes the test folder. The driver triggers `/Library/Refresh` and resolves manifest titles to item ids fresh every run, matching by item Name or by file-path basename, so nothing about ids is stored anywhere and server rescans or database rebuilds are harmless.

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
- `validate`: `copy` (exact video packet hashes), `devtc` (tolerant, VideoToolbox re-encode), `none` (mode + progress only).
- `expect`: post-remux stream layout (codecs, subtitle rendition count, audio rendition count, VIDEO-RANGE).
- `skip`: known limitation; skipped unless named in `--only`. Currently T10 (simulator rejects HDR PQ; verify on device).
- `playSeconds` / `progressMin`: play window and minimum position, lowered for short files.

## Known issues found by the suite (2026-08-07, still open)

- **Rolling-window eviction 404s** (T31): when the device transcode outruns playback (tiny files) or after a seek-restart, the 20-segment window evicts seg0 and `init.mp4` and the loopback server 404s them instead of regenerating. AVPlayer survives on cache; a back-seek into the evicted range would not. T31 hash validation is off until the engine regenerates on request. The same mechanism can make T20/T21 baselines flaky on faster hardware.
- **T10 HEVC HDR10 PQ fails on the tvOS simulator** (NSURLError -1002 on the PQ master, and the server HDR transcode also fails there). The PQ path was built against real-device behavior; needs a device run.
- **Filename misnomers**: T05's audio is DTS 5.1 (not TrueHD); T27's VC1 file has no audio stream at all. Left as-is because renaming re-creates the Jellyfin items.
- **Audio items T50 T51 T52 T53 T55 are not indexed by any library**: homevideos libraries skip bare audio (`.ogg` slips through as video, which is why T54 works). A "Test Audio" music library pointing at the folder was created via the API but did not index the loose files. Unresolved; these five currently cannot run.

## Regenerating baselines

Only from a build you trust: `npm run test:playback -- --update-baselines`. Baselines are per-machine-class stable (H.264/HEVC decode is spec-exact; packet hashes are copy-exact) but were recorded on the tvOS 26.4 simulator with the MPVKit FFmpeg build pinned by `scripts/fetch-mpvkit.js`; an FFmpeg bump that changes muxing is EXPECTED to diff the copy hashes, and that diff is the review signal, not noise to be blindly regenerated away.
