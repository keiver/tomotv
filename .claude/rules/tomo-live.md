---
paths:
  - "packages/tomo-live/**"
---

# @keiver/tomo-live

Live TV services over `@keiver/tomo-engine`. It imports nothing from the app (`@/`); `__tests__/claudeMd.test.ts` pins that.

- `packages/tomo-live/src/liveSession.ts` `LivePlayback`: one channel's play (open, bind, reopen), used by `hooks/useVideoPlayback.ts`. Neighbour channel ring `packages/tomo-live/src/liveRing.ts`, previews `packages/tomo-live/src/livePreview.ts`, guide `packages/tomo-live/src/externalGuide.ts` and `packages/tomo-live/src/guideMatch.ts`, playback hold `packages/tomo-live/src/playbackHold.ts`.
- Native: Expo module `LiveClipModule` declared in `packages/tomo-live/expo-module.config.json`, sources in `packages/tomo-live/ios/` (pod `packages/tomo-live/ios/LiveClip.podspec`).
- Tests: Jest `packages/tomo-live/__tests__/`. No Swift package.
