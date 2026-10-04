# @keiver/tomo-engine

The on-device playback engine behind [Tomo TV](https://github.com/keiver/tomotv), for
Expo apps on Apple TV and iOS. FFmpeg demuxes any container; H.264 and HEVC are stream
copied, everything else is transcoded on the device with VideoToolbox, and the result
is served to the native player as HLS from a loopback server. Text subtitles become HLS
renditions, image subtitles become timed bitmaps, Dolby and multi-audio pass through.
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

## Native modules

`LocalRemuxer` (an `RCTEventEmitter`) and `LiveSources` are legacy React Native modules
with typed wrappers in `src/`. An app's own Swift can `import TomoLiveSources` to drive the
playlist loader directly. See `NOTICE.md` for the licenses of the linked libraries.

## Host tests

```sh
swift test --package-path packages/tomo-engine
```
