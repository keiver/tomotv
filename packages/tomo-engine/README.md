# @keiver/tomo-engine

The on-device playback engine behind [Tomo TV](https://github.com/keiver/tomotv), for
Expo apps on Apple TV, iOS, and Mac Catalyst. FFmpeg demuxes any container; H.264, HEVC and AV1
are stream copied where the device's hardware decodes them, everything else is transcoded on the
device with VideoToolbox, and the result is served to the native player as HLS from a loopback
server. Text subtitles become HLS renditions, image subtitles become timed bitmaps, Dolby and
multi-audio pass through. A file session with video also gets an I-frame rendition of the
source's own keyframes (Dolby Vision profile 5 excepted), so the native player scrubs with
previews; a frame provider serves the same for a server stream.
The same package carries the live sources module: XMLTV guides and M3U playlists parsed
natively.

## Install

```sh
npm install @keiver/tomo-engine
```

`postinstall` downloads the FFmpeg xcframeworks pinned in `ffmpeg-lock.json` into
`ios/Frameworks` and checks each one's SHA256. Add the config plugin, which places the
`TomoEngine`, `TomoLiveSources` and `TomoFFmpeg` pods in the generated Podfile:

```json
{ "expo": { "plugins": ["@keiver/tomo-engine"] } }
```

Then run `expo prebuild`.

The pinned frameworks include Apple Silicon and Intel Catalyst slices for macOS
13.4 or later. A Catalyst host app must enable outgoing and incoming network
connections in its sandbox: the engine serves AVPlayer from a loopback listener.
For local artifact validation before publishing, set `TOMO_FFMPEG_ARTIFACTS_DIR`
to the directory of built ZIPs; installation still checks the pinned SHA256s.

## A session from an input alone

A session can be configured stream by stream (`EngineSessionConfig`), or left to describe itself:
the engine opens the input and reads the variant's range, size, frame rate and Dolby Vision tag,
every audio track, the text and image subtitle tracks, and the length.

```ts
import { describedSessionConfig, inputSubtitleRenditions, localRemuxToken, startSession } from "@keiver/tomo-engine";

const masterUrl = await startSession(describedSessionConfig({ inputUrl, itemId, httpHeaders, startOffsetSeconds }));
const subtitles = await inputSubtitleRenditions(localRemuxToken(masterUrl));
```

The master playlist is answered once the input is open, so the player's first request waits on
the origin. `inputSubtitleRenditions` resolves the tracks the master published; the app needs
them to draw an image track, which the engine serves as timed bitmaps.

## Live sessions

`liveSessionConfig` builds a live session from the channel's URL alone, described from the input:

```ts
import { liveSessionConfig, startSession, subscribeEngineLive } from "@keiver/tomo-engine";

const masterUrl = await startSession(liveSessionConfig({ inputUrl, itemId, httpHeaders, originKey, audioLanguage: "es", playlist: isHls }));
```

- **One variant, every rendition.** For an HLS master (a `.m3u8` or `.m3u` path, or any URL given
  `playlist: true`; any other URL is opened as given, with no request before the open) the engine
  fetches the master itself and opens a trimmed copy served from its own loopback: the top video
  variant with every audio rendition it names (its subtitle renditions the engine reads itself).
  FFmpeg then fetches no other variant.
  The `audioLanguage` rendition is the default and listed first (skipping a described-video or
  hearing-impaired one while another matches, then the master's default). The master is checked
  for DRM as it is read, and the chosen variant's playlist beside the open; either fails the
  session with `channel is DRM protected (<system>)`.
- **Subtitles.** Each SUBTITLES rendition is a track the engine follows itself (the master FFmpeg
  opens names none; a variant whose CODECS names IMSC and no WebVTT offers none): each new segment
  is read until a read succeeds, its cues placed by that segment's own `X-TIMESTAMP-MAP` once the
  video reaches them, and served as an HLS subtitle rendition on the video's window.
- **Backlog at open.** A live HLS input opens 6 segments back from its edge (`live_start_index`),
  so a provider that keeps a window fills the buffer at link speed.
- **Start buffer.** The first answer to the player's playlist waits until `bufferSeconds`
  (`LIVE_BUFFER_SECONDS`, 15) of output are cut, up to 20 s past that, and carries
  `EXT-X-START` at the oldest buffered segment, so the player starts that far behind the newest
  output. A source that gives no backlog fills it in real time; a device slower than real time
  waits here too.
- **In-session reopen.** A live read that brings nothing for twice its longest read so far (12 s at
  least), or ends, closes the input and opens it again in the same session, for as long as the
  session lives. The first try is at once; each further try, and each reopen within 60 s of the
  last, waits 0.5, 1, 2, 4, then 5 s. The streams must come back the same; output continues where
  it stopped behind a `DISCONTINUITY`, from the first keyframe past the source time already carried,
  so the player rides its buffer and sees nothing twice. A
  failed segment is skipped rather than retried (`seg_max_retry` 0). Three permanent refusals in a
  row (no demuxer, 400, 401, 403, 404, another 4xx but 429) end the session with
  `live input gone:`. The lease on the provider's budget is held through the reopen, and a refused
  reopen makes lower reads on the provider yield as the first open does; a refusal within 15 s of the
  reopen closing its own read teaches the budget nothing. A reopen whose read of the master fails
  opens the trimmed master it already holds. A timing step past the longest segment cut so far
  (never less than one segment) is a hole in the source and starts a new generation.
- **Events.** `subscribeEngineLive(token, listener)` hands each `reopening` and `reopened`
  (`EngineLiveEvent`, with the reason and the tries it took); `subscribeEngineFailure` hands the
  failure that ends the session. `progress()` carries `bufferedSeconds`.

## Provider connection limits

Every read that names a provider (`originKey`, `liveOriginKey` on a session config) takes a lease
on that provider's budget before it opens a connection. A budget is set by the app or learned
from the provider's own refusals:

```ts
import { originConnectionLimit, originConnections, setOriginConnectionBudget } from "@keiver/tomo-engine";

await setOriginConnectionBudget("provider.example", 2); // 0 forgets it
originConnectionLimit("provider.example"); // 2, the limit set; null when none is
const state = await originConnections("provider.example"); // { budget, active }
```

Budgets live in memory and are never stored: set them at launch and after every sign-in, from a
provider's own figure (Xtream `max_connections`) or the viewer's setting. Reads rank
`sweep < preview < ring < playback`, and a higher one takes a full budget's connection from the
lowest lower one; a budget set under the reads already held makes the lowest ones yield at once.

A provider's refusal of an open (any HTTP answer but a 404) while this device holds other reads on
it makes the lower reads yield and the open retry. A 4xx (401, 403, 429, 458 and the rest) also
teaches the budget; a 5xx teaches nothing, since one 503 means a full account and the next a
channel restarting. An open refused just after any close on the provider retries too, for a
provider that counts a closed stream a moment longer. A learned budget only ever goes down, which
is why it is not kept across launches: nothing could ever raise it again.

- A live session holds one connection. A file session that names its provider holds one per
  input connection: `inputConnections` asks for a count (3 when absent, 16 at most) and the input
  opens as many as the budget spares, never fewer than one.
- A session's chapter frames and I-frame rendition take a lease each and open only on a spare
  connection. On a full budget the master names no I-frame rendition.
- A poster frame given an `originKey` reads only on a spare connection and never waits for one.
- A file read or poster with no provider key takes no lease; a live read with none leases on its
  input's host.

`measureLink`, `probeInput`, `startFrameProvider` and the playlist and guide downloads open
outside any budget.

## Native modules

`LocalRemuxer` (an `RCTEventEmitter`) and `LiveSources` are legacy React Native modules
with typed wrappers in `src/`. An app's own Swift can `import TomoLiveSources` to drive the
playlist loader directly. See `NOTICE.md` for the licenses of the linked libraries.

## Host tests

```sh
swift test --package-path packages/tomo-engine
```

## Releasing

A commit that touches this package while its version is already on npm gets a patch bump from the
pre-commit hook (`scripts/package-versions.mjs`), and Test PR fails a change that reached GitHub
without one. A minor or major bump is `npm run release:engine -- minor|major` with a `CHANGELOG.md`
entry. When the PR merges to `main`,
`.github/workflows/publish-packages.yml` publishes any version npm does not have yet, with
provenance, and creates the `tomo-engine-v<version>` GitHub release.
