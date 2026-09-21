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

Every file plays in the system's own `AVPlayer`. A file AVPlayer opens as it is
plays straight from the server; for the rest, a native engine that ships its own
FFmpeg runs on the device and hands AVKit an HLS stream it writes itself. The
server sends bytes; the device does the format work; the platform does the
playing, with the transport, AirPlay and Picture in Picture it already has.

```
Jellyfin server
    |  the file as it is
    v
Engine on the device        native/ios/LocalRemuxer, with its own FFmpeg
    |  copies the streams, or decodes and re-encodes through VideoToolbox
    |  decodes subtitles, rewrites Dolby Vision profile 7 to 8.1
    v
HLS on loopback             a playlist and segments the engine writes
    |
    v
AVPlayer / AVKit            the platform's player, transport, AirPlay, PiP
```

Playback starts in one of four lanes:

| Lane                    | What happens                                       |
| ----------------------- | -------------------------------------------------- |
| **Direct play**         | AVPlayer reads the file from the server as it is   |
| **On-device copy**      | Container rewrapped, streams copied byte for byte  |
| **On-device transcode** | Software decode + VideoToolbox encode, still local |
| **Server**              | Jellyfin transcodes; the fallback, not the default |

The lane is measured, not assumed. Video is copied only where this device
decodes it in hardware: the engine opens a VideoToolbox session against the
file's own parameter sets, at the file's own size, with a hardware decoder
required, so a box with no HEVC silicon re-encodes rather than handing AVPlayer
a stream it can only decode in software, and a frame taller than the decoder
opens takes the same path. Every other codec on the engine's list is decoded in
software and re-encoded on the device, at any size, interlaced or not. The
first-segment timing gate applies outside adaptive sessions. If on-device
conversion cannot keep up, playback falls back to the server. Two such
measurements on one build keep that file on the server.

- **Dolby Vision** profiles 8.1 and 8.4 ride a stream copy. Profile 7, which
  Apple decodes nowhere, is rewritten to single-layer 8.1 as the copy runs.
- **Original-quality audio** AVPlayer decodes (AAC, ALAC, AC-3, E-AC-3, FLAC)
  is copied, so Dolby Atmos passes through untouched. Everything else the
  engine carries (TrueHD, DTS-HD, PCM, MP3, Opus and the rest) is decoded and
  rewrapped as lossless FLAC, up to 7.1.
- **Subtitles** never send a file to the server's transcoder on their own.
  Embedded text tracks are decoded on the device and served as WebVTT; a sidecar
  file is read from the server as it is; image tracks (PGS, VobSub, DVB, XSUB)
  are decoded to bitmaps the app draws over the native player.
- **Quality.** Auto uses original quality on fast connections and smaller
  server-converted streams on slow connections, with transcoding permission.
  Eligible sessions keep both in one playlist and adapt without replacing
  the player. Server fallback segments are not prefetched when the original
  leads. All audio and subtitle tracks remain selectable; smaller streams
  use up to stereo AAC audio. Fixed presets cap both playback paths.
- **Live TV** channels ride the same engine, cut live on keyframes. An HLS or
  DASH origin is read directly, a tuner stream arrives through the server
  untouched, and the server's live transcode is the rung below.
- **FFmpeg** is built here, not vendored: every native decoder enabled, from
  pinned sources, published by CI and fetched on `postinstall`. That is why
  DivX 3, Theora, DV, Cinepak, RealVideo and VVC play on the device.

## Beyond playback

- **Live TV.** A guide laid out by time and channel, and Recordings; accounts the
  server lets manage recordings also get the Schedule and record controls. On
  Apple TV the remote's channel-skip gesture flips channels, and the channels
  either side keep running in the engine.
- **Books.** PDF, comics (CBZ, CBR, CBT, CB7), EPUB, MOBI and Kindle AZW/AZW3 in
  a full-screen reader, with the reading position written back to the server.
- **Languages.** English, German, French and Spanish, following the device.
- **Downloads.** On iPhone and iPad an item or a whole folder is kept on the
  device and plays with no server in reach, positions included.
- **SyncPlay.** Jellyfin's own watch-together. Settings, SyncPlay lists the
  server's groups, or makes one when there is none, and shows its join code; a
  phone on the same server scans it with the camera and is in. The server drives
  every member's player, and nobody starts until everyone can.
- **Diagnostics.** The last playback as a versioned JSON document
  ([schema](docs/diagnostics-session.schema.json)): the lane, the engine's
  reasons, the streams, every error, and the device with what it decodes in
  hardware. Copy or share it on the phone; send it from the Apple TV to your
  phone through your own account on the server. Nothing goes anywhere else.
- **Music** keeps playing while you browse, with Now Playing and the tvOS Up
  Next panel; multi-audio switches seamlessly. On Apple TV, Skip Intro and Skip
  Credits read Media Segments, chapters carry pictures, and the Top Shelf shows
  what you are watching.

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
Quick Connect or a password, add as many servers as you want, or press Go on the
empty Add Server field for Jellyfin's public demo.

## Code map

```
app/                    expo-router screens
components/             UI
hooks/useVideoPlayback  the playback state machine
services/
  localRemux.ts         lane prediction, codec allowlists, engine session control
  jellyfin/             API client, split by concern
  syncPlayManager.ts    SyncPlay group, command scheduler, handshake
  liveRing.ts           Live TV channel ring kept running for flips
  downloads/            offline store
  books/                book formats and reading position
  i18n/                 string catalogues: en, de, fr, es
native/ios/
  LocalRemuxer/         the engine: remux, transcode, loopback server, subtitles, Dolby Vision, live
  MultiAudioResourceLoader/   HLS manifest generation, seamless audio switching
  AudioQueuePlayer/     native queue player, Now Playing, tvOS Up Next panel
  BookRenderer/         PDF, comic archive, EPUB and MOBI pages
  TopShelf/             tvOS Top Shelf extension
  Package.swift         host-side SwiftPM package for the engine and book tests
constants/codecs.ts     direct-play registry and engine codec allowlists
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
the tvOS AVKit surfaces (Up Next, info panel, chapters, channel flipping) and
fixes upstream bugs. An upgrade that breaks the patch fails the install rather than dropping
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
across 82 manifest items (77 files, 5 Live TV channels) and catches what unit
tests cannot: an item quietly taking the wrong lane, playback that does not
advance, and engine output that changed, since the loopback HLS is checked
against committed baselines. If you
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
(LGPL 3.0), libzvbi (LGPL 2.0 or later), Mbed TLS, dav1d, uavs3d, libass,
FreeType, HarfBuzz, GNU FriBidi, libarchive, XZ Utils and foliate-js.
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
