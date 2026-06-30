# Common Development Patterns

**Last Updated:** January 24, 2026

## Quick Reference

**Category:** Implementation
**Keywords:** patterns, hooks, routing, video playback, API usage, search, logging

Common development patterns for screens, API methods, video playback, hooks, and component usage.

## Related Documentation

- [`CLAUDE-api-reference.md`](./CLAUDE-api-reference.md) - API usage examples
- [`CLAUDE-state-management.md`](./CLAUDE-state-management.md) - State management patterns
- [`CLAUDE-testing.md`](./CLAUDE-testing.md) - Testing patterns
- [`CLAUDE-app-performance.md`](./CLAUDE-app-performance.md) - Performance patterns
- [`CLAUDE-components.md`](./CLAUDE-components.md) - Component patterns
- [`CLAUDE-development.md`](./CLAUDE-development.md) - Development workflow
- [`CLAUDE-lessons-learned.md`](./CLAUDE-lessons-learned.md) - Lessons inform best practices
- [`CLAUDE-multi-audio.md`](./CLAUDE-multi-audio.md) - Multi-audio implementation patterns

---

## Adding a New Screen

1. Create file in `app/` folder (e.g., `app/profile.tsx`)
2. Export default component
3. Route is auto-generated (`/profile`)
4. Use `router.push('/profile')` to navigate

## Adding a New API Method

1. Add function to `services/jellyfinApi.ts`
2. Use `retryWithBackoff()` for network calls
3. Log errors with `utils/logger.ts`
4. Cache configuration with `getConfig()`

## Video Playback Implementation

Use the `useVideoPlayback` hook:

```typescript
const { state, videoRef, error, playVideo, retryPlayback } = useVideoPlayback();
```

The hook handles:

- Codec detection and transcoding decisions
- Stream URL generation
- Error recovery with retry

### useVideoPlayback() - State Flow

```
┌────────────────────────────────────────────────────────────────┐
│ IDLE (Initial State)                                           │
│ ↓ playVideo(videoId) called                                    │
├────────────────────────────────────────────────────────────────┤
│ FETCHING_METADATA                                              │
│ - Fetches video details from Jellyfin API                      │
│ - Detects codec (H.264/HEVC = direct play, else transcode)    │
│ - Error → ERROR state (no retry)                               │
│ ↓ success                                                      │
├────────────────────────────────────────────────────────────────┤
│ CREATING_STREAM                                                │
│ - Generates stream URL (direct play or transcode)              │
│ - Prepares multi-audio if needed (>1 audio track)              │
│ - Error → ERROR state (no retry)                               │
│ ↓ success                                                      │
├────────────────────────────────────────────────────────────────┤
│ INITIALIZING_PLAYER                                            │
│ - Passes URL to react-native-video player                      │
│ - Player loads and buffers first segments                      │
│ - Error → ERROR state (WITH auto-retry if !hasRetried)         │
│ ↓ onLoad callback                                              │
├────────────────────────────────────────────────────────────────┤
│ READY                                                          │
│ - Video buffered, ready to play                                │
│ - Auto-advances to PLAYING after 100ms delay                   │
│ ↓ auto-play triggered                                          │
├────────────────────────────────────────────────────────────────┤
│ PLAYING                                                        │
│ - Video actively playing                                       │
│ - User can pause/seek via native controls                      │
│ - Stable playback detection (500ms) → hide spinner             │
│ - Error during playback → ERROR state (no retry)               │
└────────────────────────────────────────────────────────────────┘

            ┌─────────────────────────────────┐
            │ ERROR (Terminal State)          │
            │ - User can retry manually       │
            │ - Shows error UI with:          │
            │   * User-friendly message       │
            │   * "Retry" button              │
            │   * "Go to Settings" button     │
            └─────────────────────────────────┘
```

**Auto-Retry Logic:**

- Only `PLAYBACK` errors trigger automatic retry
- First attempt: Direct play (if codec H.264/HEVC)
- Auto-retry: Transcode (if direct play fails and `hasRetried=false`)
- Manual retry: User can retry from ERROR state

**Thread Safety:**

- `isMountedRef` prevents state updates after unmount
- `requestIdRef` discards stale responses (rapid video switches)
- `InteractionManager.runAfterInteractions()` ensures main thread updates

**Demo Mode Special Handling:**

- 401 errors trigger automatic credential refresh
- Calls `connectToDemoServer(false)` to preserve UI state
- Maximum 1 credential refresh per session

## Custom React Hooks

### useColorScheme()

Platform-specific dark/light mode detection

### useAppStateRefresh()

Auto-refresh data when app returns to foreground

- Used in LibraryContext to refresh library on app resume
- Hooks into `AppState` event listener
- Prevents stale data after backgrounding

## Logging

```typescript
import { logger } from "@/utils/logger";

logger.info("Operation started", { videoId: "123" });
logger.error("Operation failed", { error: err });
```

## Search Implementation

The search screen (`app/(tabs)/search.tsx`) has two implementations:

### Native tvOS Search

When `isNativeSearchAvailable()` returns true:

- Uses `expo-tvos-search` package (external repo)
- Native SwiftUI `.searchable` modifier for keyboard integration
- Fixed 280x420 card grid with poster images
- To modify UI: edit `~/@keiver/expo-tvos-search/ios/ExpoTvosSearchView.swift`

### React Native Fallback

For iOS/Android:

- Debounced text input (300ms delay)
- Same grid layout as library view using `VideoGridItem` component

### Search API

`services/jellyfinApi.ts`:

- `searchVideos()` searches across all libraries (Movies, Shows, Music)
- Supports year filtering: "action 2023", "90s", "2019-2023"
- Automatically expands Series results to playable Episodes
- Returns only playable items (Movie, Video, Episode, Audio)
- Path/folder names are searchable via Jellyfin's SearchTerm

---

## Architecture Reference

### Technology Stack

- **React Native TVOS** (`npm:react-native-tvos@0.81.4-0`) - TV-optimized React Native
- **Expo Router** 6.0.14 - File-based routing with typed routes
- **react-native-video** 6.19.x - Native video playback with full codec support
- **React Native Reanimated** 4.1.0 - GPU-accelerated animations
- **TypeScript** 5.9.2 - Full type safety
- **Jest** 29.7.0 - Testing framework
- **expo-tvos-search** 1.3.1 - Native tvOS search UI (separate repo)

### Folder Structure

```
app/              # Expo Router screens (file-based routing)
  (tabs)/         # Native tab navigation group (Library, Search, Settings, Help)
    (library)/    # Library tab = nested Stack: index.tsx (libraries) + [folderId].tsx (folder)
  player.tsx      # Full-screen video player (modal)
components/       # Reusable UI components
contexts/         # React Context providers + singleton manager wrappers
hooks/            # Custom React hooks (useVideoPlayback, useFolderContents, useAppStateRefresh)
services/         # API integration + singleton state managers
utils/            # Utility functions (logger, retry)
types/            # TypeScript type definitions
```

### Error Classification System

| Error Type       | Description                               | Recovery Strategy           |
| ---------------- | ----------------------------------------- | --------------------------- |
| `METADATA_FETCH` | Failed to fetch video details from server | User retry only             |
| `STREAM_URL`     | Failed to generate stream URL             | User retry only             |
| `PLAYBACK`       | Video player initialization failed        | Auto-retry with transcoding |
| `NETWORK`        | Network timeout or connection error       | User retry only             |
| `UNKNOWN`        | Unclassified errors                       | User retry only             |

Only `PLAYBACK` errors trigger automatic retry (first attempt: direct play, second: transcoding, max 1 auto-retry).

### Codec and Streaming Strategy

- **Direct Play:** H.264, HEVC (natively supported on iOS/tvOS)
- **Transcoding:** All other codecs (MPEG-4, VP8, VP9, AV1, VC-1, MPEG-2, DivX, Xvid)
- **HLS Master.m3u8:** Primary transcoding endpoint with adaptive bitrate
- **Direct Download:** Fallback for direct-compatible files
- **Subtitle Handling:** Both external (.srt) and embedded subtitle tracks included in HLS manifest as toggleable WebVTT streams via SubtitleMethod=Hls

### Platform-Specific Features

- **iOS/tvOS:** Native tabs, larger UI elements. Folder drill-down is a real nested Stack, so the
  Apple TV **Menu button pops the stack natively** — do NOT attach a JS Menu handler
  (`enableTVMenuKey` / `useTVEventHandler('menu')`), which breaks the native behavior
- **Android:** Hardware back button support
- **Web:** React Native Web with responsive design
- **TV-Specific:** Focus management with `isTVSelectable`, directional navigation
