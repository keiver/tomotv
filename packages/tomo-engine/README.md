# @keiver/tomo-engine

The on-device playback engine behind [Tomo TV](https://github.com/keiver/tomotv), for
Expo apps on Apple TV, iOS, and Mac Catalyst. FFmpeg demuxes any container; H.264 and HEVC are stream
copied, everything else is transcoded on the device with VideoToolbox, and the result
is served to the native player as HLS from a loopback server. Text subtitles become HLS
renditions, image subtitles become timed bitmaps, Dolby and multi-audio pass through.
Every session with video also gets an I-frame rendition of the source's own keyframes, so
the native player scrubs with previews; a frame provider serves the same for a server stream.
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

## Provider connection limits

Every read that names a provider (`originKey`, `liveOriginKey` on a session config) takes a lease
on that provider's budget before it opens a connection. A budget is set by the app or learned
from the provider's own refusals:

```ts
import { originConnections, setOriginConnectionBudget } from "@keiver/tomo-engine";

await setOriginConnectionBudget("provider.example", 2); // 0 forgets it
const state = await originConnections("provider.example"); // { budget, active }
```

Budgets live in memory: set them at launch. Reads rank `sweep < preview < ring < playback`, and a
higher one takes a full budget's connection from the lowest lower one.

- A live session holds one connection. A file session that names its provider holds one per
  input connection: `inputConnections` asks for a count (3 when absent, 16 at most) and the input
  opens as many as the budget spares, never fewer than one.
- A session's chapter frames and I-frame rendition take a lease each and open only on a spare
  connection. On a full budget the master names no I-frame rendition.
- A poster frame given an `originKey` reads only on a spare connection and never waits for one.
- A read with no provider key takes no lease.

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
