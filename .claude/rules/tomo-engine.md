---
paths:
  - "packages/tomo-engine/**"
---

# @keiver/tomo-engine

The on-device playback engine. It imports nothing from the app (`@/`) and nothing from `@keiver/tomo-live`; `__tests__/claudeMd.test.ts` pins both.

## Layout

- JS entry `packages/tomo-engine/src/index.ts` re-exports every module. `packages/tomo-engine/src/session.ts` `startSession`, `stopLocalRemux` open and close a session; `packages/tomo-engine/src/native.ts` `engineModule`, `isLocalRemuxAvailable` reach the native module; `packages/tomo-engine/src/verdicts.ts` `VERDICT_STRIKES`, `VERDICT_TTL_MS` hold the below-realtime memory; `packages/tomo-engine/src/imageSubtitleOverlay.tsx` `ImageSubtitleOverlay` draws image subtitles.
- Native engine `packages/tomo-engine/ios/LocalRemuxer/`: React Native module `packages/tomo-engine/ios/LocalRemuxer/LocalRemuxer.swift` `LocalRemuxer` (bridged in `packages/tomo-engine/ios/LocalRemuxer/LocalRemuxer.m`), the session in `packages/tomo-engine/ios/LocalRemuxer/Remuxer.swift` and `packages/tomo-engine/ios/LocalRemuxer/RemuxSession+*.swift`, transcoders in `packages/tomo-engine/ios/LocalRemuxer/VideoTranscoder.swift` and `packages/tomo-engine/ios/LocalRemuxer/AudioTranscoder.swift`, subtitle decoders in `packages/tomo-engine/ios/LocalRemuxer/ImageSubtitleDecoder.swift` and `packages/tomo-engine/ios/LocalRemuxer/TextSubtitleDecoder.swift`.
- Native live sources `packages/tomo-engine/ios/LiveSources/` (module `LiveSources`): `packages/tomo-engine/ios/LiveSources/M3uParser.swift`, `packages/tomo-engine/ios/LiveSources/XmltvParser.swift`.

## Build

- `packages/tomo-engine/app.plugin.js` `addEnginePods` adds the TomoEngine, TomoLiveSources and TomoFFmpeg pods (`packages/tomo-engine/ios/*.podspec`) to the Podfile. The podspecs glob their folders, so a new Swift file needs no registration.
- SwiftPM `packages/tomo-engine/Package.swift` builds the same sources for `swift build`/`swift test` but excludes the bridge files (`LocalRemuxer.swift`/`.m`, `LiveSources.swift`/`.m`): those compile only in Xcode.
- FFmpeg: built by `scripts/ffmpeg/build.sh`, published by `.github/workflows/build-ffmpeg.yml`, fetched into the gitignored ios/Frameworks folder by `packages/tomo-engine/scripts/fetch-ffmpeg.js` (postinstall), pinned by `packages/tomo-engine/ffmpeg-lock.json`.
- Tests: Jest `packages/tomo-engine/__tests__/`; Swift `packages/tomo-engine/Tests/TomoEngineTests/` and `packages/tomo-engine/Tests/TomoLiveSourcesTests/`.

## Engine facts

- The engine's session anchor is the first keyframe it sees: the first generation MUST open at position 0. Move the segment index, never the clock.
- Per-pixel/per-sample realtime loops belong in the -O2 FFmpeg frameworks, never app-target Swift (Debug runs ~300x slower).
- Before changing the HLS master shape, read Apple's HLS authoring spec appendixes, not only RFC 8216.
