# Tomo TV

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-tvOS%20%7C%20iOS%20%7C%20iPadOS-lightgrey.svg)
[![Tests](https://github.com/keiver/tomotv/actions/workflows/test-pr.yml/badge.svg)](https://github.com/keiver/tomotv/actions/workflows/test-pr.yml)
[![Download on the App Store](https://img.shields.io/badge/App_Store-Download-black?logo=apple&logoColor=white)](https://apps.apple.com/us/app/tomo-tv/id6755077888)

A free, open source Jellyfin client for Apple TV, iPhone and iPad, built with
React Native (react-native-tvos) and Expo.

<p align="center">
  <img src="assets/images/screenshots/home.webp" width="100%" alt="Tomo TV Home on an Apple TV: a Libraries row of Films, Format Lab, Home Videos and Photos and Music, each tile carrying its item count, above a Continue row of wide cards with yellow progress bars, gold favourite hearts and watched checkmarks, and a Favorites row beginning below"/>
</p>

## Architecture

Every file plays in the system's own `AVPlayer`. Between your server and that
player sits a native engine that ships its own FFmpeg, runs on the device, and
hands AVKit an HLS stream it writes itself. The server sends bytes; the device
does the format work; the platform does the playing, with the transport, AirPlay
and Picture in Picture it already has.

```
Jellyfin ──bytes──▶ engine (native/ios/LocalRemuxer) ──HLS over loopback──▶ AVPlayer / AVKit
                    remux · decode + VideoToolbox encode · subtitles · Dolby Vision
```

Each item takes one of three lanes, chosen before playback starts:

| Lane                    | What happens                                       |
| ----------------------- | -------------------------------------------------- |
| **Direct play**         | Container rewrapped, streams copied byte for byte  |
| **On-device transcode** | Software decode + VideoToolbox encode, still local |
| **Server**              | Jellyfin transcodes; the fallback, not the default |

The lane is measured, not assumed. Video is copied only where this device
decodes it in hardware: the engine opens a VideoToolbox session against the
file's own parameter sets, at the file's own size, with a hardware decoder
required, so a box with no HEVC silicon re-encodes rather than handing AVPlayer
a stream it can only decode in software, and a frame taller than the decoder
opens takes the same path. Everything else the linked FFmpeg decodes is decoded
in software and re-encoded on the device, at any size, interlaced or not. The
engine times its first segment before the player is bound; a device that runs
below realtime on a file hands it to the server with nothing on screen to
restart, and remembers that answer per file.

- **Dolby Vision** profiles 8.1 and 8.4 ride a stream copy. Profile 7, which
  Apple decodes nowhere, is rewritten to single-layer 8.1 as the copy runs.
- **Audio** AVPlayer decodes (AAC, ALAC, AC-3, E-AC-3, FLAC) is copied, so Dolby
  Atmos passes through untouched. Everything else (TrueHD, DTS-HD, PCM, Opus and
  the rest) is decoded and rewrapped as FLAC, every channel and bit kept.
- **Subtitles** send nothing to the server. Text tracks ship as HLS renditions;
  image tracks (PGS, VobSub, DVB, XSUB) are decoded to bitmaps and drawn over
  the native player.
- **Quality.** Auto measures the link to each server and opens on the highest
  rung it carries, the original file as the ceiling. The engine lane also
  declares a small server-fed rung when the link cannot carry the file, proved
  before it is offered, and AVPlayer switches between them on a shared segment
  grid with no reload. Presets govern the server lane only.
- **FFmpeg** is built here, not vendored: every native decoder enabled, from
  pinned sources, published by CI and fetched on `postinstall`. That is why
  DivX 3, Theora, DV, Cinepak, RealVideo and VVC play on the device.

## Beyond playback

- **Downloads.** On iPhone and iPad an item or a whole folder is kept on the
  device and plays with no server in reach, positions included.
- **SyncPlay.** Jellyfin's own watch-together. Settings, SyncPlay makes a group
  and shows its join code; a phone on the same server scans it and is in. The
  server drives every member's player, and nobody starts until everyone can.
- **Diagnostics.** The last playback as a versioned JSON document
  ([schema](docs/diagnostics-session.schema.json)): the lane, the engine's
  reasons, the streams, every error, and the device with what it decodes in
  hardware. Copy or share it on the phone; send it from the Apple TV to your
  phone through your own account on the server. Nothing goes anywhere else.
- **Music** keeps playing while you browse, with Now Playing and the tvOS Up
  Next panel; multi-audio switches seamlessly; Skip Intro and Skip Credits read
  Media Segments; chapters carry pictures; the Apple TV Top Shelf shows what
  you are watching.

## Getting started

A Jellyfin server (10.10+ for Media Segments), Node.js, Xcode with the iOS and
tvOS 26 SDKs, CocoaPods (installed through Homebrew when missing).

```bash
git clone https://github.com/keiver/tomotv.git
cd tomotv
npm install            # patches deps, fetches the FFmpeg xcframeworks, regenerates licenses
npm run prebuild:tv    # regenerate the native project (deletes ios/)
npm run ios            # build and run on the tvOS simulator
```

Then **Settings → Scan Network**. Tomo TV sweeps the local subnet, so there is
no address to type; manual entry accepts reverse-proxy subpaths. Sign in with
Quick Connect or a password, add as many servers as you want, or use Jellyfin's
public demo.

## Code map

```
app/                    expo-router screens
components/             UI
hooks/useVideoPlayback  the playback state machine
services/
  localRemux.ts         lane prediction, codec allowlists, engine session control
  jellyfin/             API client, split by concern
  syncPlayManager.ts    SyncPlay group, command scheduler, handshake
  downloads/            offline store
native/ios/
  LocalRemuxer/         the engine: remux, transcode, loopback server, subtitles, Dolby Vision
  MultiAudioResourceLoader/   HLS manifest generation, seamless audio switching
  AudioQueuePlayer/     native queue player, Now Playing, tvOS Up Next panel
  TopShelf/             tvOS Top Shelf extension
  Package.swift         host-side SwiftPM package for the engine tests
constants/codecs.ts     direct-play registry, shared by JS and the engine
test/playback/          the playback regression matrix
```

Native code lives in `native/`. The `ios/` folder is generated by prebuild and
any edit there is lost.

## Development

```bash
npm start            # dev server
npm run logs         # native logs from the booted simulator, in a pane beside npm start
npm run ios          # build and run
npm test             # unit tests, native modules mocked
npm run lint         # eslint + prettier
npm run prebuild:tv  # regenerate the native project (deletes ios/)
```

`react-native-video` carries a local patch, applied on `postinstall`, that adds
the tvOS AVKit surfaces (Up Next, info panel, chapters) and fixes two upstream
bugs. An upgrade that breaks the patch fails the install rather than dropping
those features. To edit it, change `node_modules/react-native-video/` and run
`npx patch-package react-native-video`, then prebuild and run on a device.

Releasing is a maintainer step: [`docs/RELEASING.md`](docs/RELEASING.md).

## Testing

```bash
npm test                # jest: unit and integration
npm run test:engine     # the engine's Swift, on the Mac, no simulator
npm run test:playback   # the real thing, against a real server, on a simulator
```

`test:engine` runs the engine sources on the Mac: Dolby Vision conversion against
committed fixtures, the playlist rules, and a codec matrix that measures coverage
rather than claiming it ([`docs/playback-coverage.md`](docs/playback-coverage.md)).

The playback suite deep-links into the player against a real Jellyfin server
across 71 manifest items and catches what unit tests cannot: an item quietly
taking the wrong lane, playback that does not advance, and engine output that
changed, since the loopback HLS is hashed against committed baselines. If you
touch the engine or the allowlists, run it and say so in the PR. See
[`test/playback/README.md`](test/playback/README.md).

## Contributing

Fork, branch from `main`, follow the existing patterns, add tests, and run
`npm test` and `npm run lint` before opening a PR. Strict TypeScript, cleanup on
every effect, and no scale animations on grid items.

## Known limitations

- **Platform.** tvOS, iOS and iPadOS; the iPad build runs on Apple silicon Macs
  as the iPad app. No Android.
- **Downloads** are iPhone and iPad only: tvOS gives an app no persistent
  storage to keep files in.
- **Server.** Jellyfin only.
- **Network.** HTTP is permitted on every network. Use HTTPS beyond your LAN.

## A Note on AI

I use Claude and other AI tools for drafting code and documentation.
Architecture and decisions are mine. Blame me for any shady code.

## License

MIT. See [LICENSE](LICENSE).

The shipped media stack is third-party and separately licensed: FFmpeg
(LGPL 3.0), Mbed TLS, dav1d, uavs3d, libass, FreeType, HarfBuzz and GNU FriBidi.
Full texts and per-component copyright are in the app under
**Settings → Open Source**.

## Acknowledgments

- **Jellyfin Team** for the open source media server
- **Expo** and **react-native-tvos** for Apple TV support
- **Blender Foundation** for open movie test files (Sintel, Cosmos Laundromat)
- The **Matroska test suite** for container test files used in development

## Links

- **Site:** [tomotv.app](https://tomotv.app/)
- **Support:** <contact@keiver.dev>
- **expo-tvos-search:** [github.com/keiver/expo-tvos-search](https://github.com/keiver/expo-tvos-search)
