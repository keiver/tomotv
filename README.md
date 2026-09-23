# Tomo TV

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-tvOS%20%7C%20iOS%20%7C%20iPadOS-lightgrey.svg)
[![Tests](https://github.com/keiver/tomotv/actions/workflows/test-pr.yml/badge.svg)](https://github.com/keiver/tomotv/actions/workflows/test-pr.yml)
[![Download on the App Store](https://img.shields.io/badge/App_Store-Download-black?logo=apple&logoColor=white)](https://apps.apple.com/us/app/tomo-tv/id6755077888)

A free, open source Jellyfin client for Apple TV, iPhone and iPad. Files play at
original quality in Apple's own player, with an on-device FFmpeg engine doing the
format work the server would otherwise transcode: MKV and AVI, Dolby Vision,
Dolby Atmos, PGS subtitles and Live TV. Built with React Native (react-native-tvos)
and Expo.

<p align="center">
  <img src="assets/images/screenshots/home.webp" width="100%" alt="Tomo TV Home on Apple TV: a Libraries row of Live TV, Music, Home Videos and Photos and Films, above a Continue row of episode and movie cards with yellow progress bars"/>
</p>

## How playback works

Every file plays in the system's `AVPlayer`, so the transport, AirPlay and
Picture in Picture are Apple's own. A file AVPlayer can open plays straight from
the server. For everything else, an engine on the device reads the original file,
does the format work with its own FFmpeg build, and hands AVPlayer an HLS stream
it serves on loopback.

```
Jellyfin server
    |  the original file
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

Each session starts in one of four lanes:

| Lane                    | What happens                                       |
| ----------------------- | -------------------------------------------------- |
| **Direct play**         | AVPlayer reads the file from the server as it is   |
| **On-device copy**      | Container rewrapped, streams copied byte for byte  |
| **On-device transcode** | Software decode + VideoToolbox encode, still local |
| **Server**              | Jellyfin transcodes; the fallback, not the default |

The lane is measured on the device, not assumed. H.264 and HEVC are copied only
when this device's VideoToolbox opens them in hardware at the file's own size;
otherwise they are re-encoded locally, like every other codec the engine
accepts. If on-device conversion cannot keep up, playback falls back to the
server. Two such measurements on the same app build keep that file on the
server for 30 minutes.

- **Dolby Vision.** Profiles 8.1 and 8.4 are copied as they are. Profile 7,
  which no Apple device decodes, is rewritten to single-layer 8.1 during the copy.
- **Audio.** AAC, ALAC, AC-3, E-AC-3 and FLAC are copied, so Dolby Atmos reaches
  the receiver untouched. TrueHD, DTS-HD, PCM, MP3, Opus and the rest are decoded
  to lossless FLAC, up to 7.1. Switching audio tracks does not restart playback.
- **Subtitles** never send a file to the server's transcoder. Embedded text
  tracks become WebVTT on the device, sidecar files are read from the server as
  they are, and image tracks (PGS, VobSub, DVB, XSUB) are decoded to bitmaps
  drawn over the native player.
- **Quality.** Auto plays the original when the connection can carry it, and
  otherwise a smaller server stream (stereo AAC), if the account is allowed to
  transcode. Both can sit in one playlist, so AVPlayer switches between them
  without a restart. Fixed presets cap either path.
- **Live TV** uses the same engine. HLS and DASH origins are read directly, tuner
  streams arrive through the server untouched, and the server's live transcode
  is the fallback.
- **FFmpeg** is built in this repo from pinned sources, with every native decoder
  enabled, published by CI and fetched on `npm install`. DivX 3, RealVideo,
  Theora, DV and Cinepak all play on the device; the measured list is in
  [`docs/playback-coverage.md`](docs/playback-coverage.md).

## Features

- **Live TV.** A guide by time and channel, a wall of every channel with live
  previews, and Recordings with filters. Accounts allowed to manage recordings
  also get the schedule and record controls. Hold a channel to make it a
  favorite. On Apple TV, the remote's channel-skip gesture flips channels, and
  the channels on either side keep running, ready for the flip.
- **Books.** PDF, comics (CBZ, CBR, CBT, CB7), EPUB, MOBI and Kindle AZW/AZW3 in a
  full-screen reader, with the reading position saved to the server.
- **Downloads** on iPhone and iPad: an item or a whole folder, playable with no
  server in reach, with watch positions synced back later.
- **SyncPlay**, Jellyfin's watch-together. The Apple TV shows a join code; a
  phone signed in to the same server scans it with the camera to join.
- **Apple TV.** Skip Intro and Skip Credits from Jellyfin's Media Segments,
  chapter thumbnails, the Up Next panel, and Continue Watching on the Top Shelf.
- **Music** keeps playing while you browse, with Now Playing controls.
- **Diagnostics.** The last playback as a versioned JSON document
  ([schema](docs/diagnostics-session.schema.json)): the lane, why the engine
  chose it, the streams, every error, and what the device decodes in hardware.
  Share it from the phone, or send it from the Apple TV to your phone through
  your own account on the server. Nothing goes anywhere else.
- **Languages.** English, German, French and Spanish, following the device.

## Getting started

You need a Jellyfin server (10.10 or later for Skip Intro), Node.js 18 or later,
and Xcode 26 or later. CocoaPods is installed through Homebrew if missing.

```bash
git clone https://github.com/keiver/tomotv.git
cd tomotv
npm install            # applies patches, fetches the FFmpeg frameworks, regenerates licenses
npm run prebuild:tv    # generates the native project (replaces ios/)
npm run ios            # builds and runs on the tvOS simulator
```

In the app, open **Settings → Scan Network** to find servers on your network, or
type an address; reverse-proxy paths work. Sign in with Quick Connect or a
password. Submitting the empty Add Server field connects to Jellyfin's public
demo.

## Development

```bash
npm start               # Metro dev server
npm run logs            # native logs from the booted simulator
npm run lint            # eslint + prettier
npm test                # jest unit and integration tests
npm run test:engine     # the engine's Swift tests, on the Mac
npm run test:playback   # the playback suite, against a real server
```

Native code lives in `native/`. The `ios/` folder is generated by prebuild, and
edits there are lost.

```
app/                    expo-router screens
components/             UI
hooks/useVideoPlayback  the playback state machine
services/
  localRemux.ts         lane choice, engine codec allowlists, engine sessions
  jellyfin/             API client, split by concern
  syncPlayManager.ts    SyncPlay groups and command scheduling
  liveRing.ts           Live TV channels kept running for flips
  downloads/            offline store
  books/                book formats and reading position
  i18n/                 strings: en, de, fr, es
native/ios/
  LocalRemuxer/         the engine: remux, transcode, loopback server, subtitles, Dolby Vision, live
  MultiAudioResourceLoader/   HLS manifests, audio track switching
  AudioQueuePlayer/     music queue, Now Playing, tvOS Up Next panel
  BookRenderer/         PDF, comic, EPUB and MOBI pages
  TopShelf/             tvOS Top Shelf extension
  Package.swift         SwiftPM package for the engine and book tests
constants/codecs.ts     the direct-play codec list
test/playback/          the playback regression suite
```

`test:engine` runs the engine on the Mac: Dolby Vision conversion against
committed fixtures, the playlist rules, and a codec matrix that records which
codecs are proven by a fixture.

`test:playback` deep-links the app into the player against a real Jellyfin server,
across 82 items (77 files and 5 Live TV channels). It catches what unit tests
cannot: an item taking the wrong lane, playback that does not advance, and engine
output that drifts from the committed baselines. If you touch the engine or its
allowlists, run it and say so in the PR. See
[`test/playback/README.md`](test/playback/README.md).

`react-native-video` carries a local patch, applied on `npm install`, for the tvOS
AVKit features (Up Next, the info panel, chapters, channel flipping) and upstream
fixes. An upgrade that breaks the patch fails the install instead of silently
dropping them. To change it, edit `node_modules/react-native-video/` and run
`npx patch-package react-native-video`.

Releasing is a maintainer step: [`docs/RELEASING.md`](docs/RELEASING.md).

## Contributing

Fork, branch from `main`, follow the existing patterns, add tests, and run
`npm test` and `npm run lint` before opening a PR. Strict TypeScript, cleanup on
every effect, and no scale animations on grid items.

## Known limitations

- **Platforms.** tvOS, iOS and iPadOS; the iPad app also runs on Apple silicon
  Macs. No Android.
- **Downloads** are iPhone and iPad only: tvOS gives apps no persistent storage.
- **Server.** Jellyfin only.
- **Network.** HTTP is allowed on every network. Use HTTPS beyond your LAN.

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
