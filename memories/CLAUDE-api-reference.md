# API Functions Reference

**Last Updated:** January 24, 2026

## Quick Reference

**Category:** Implementation
**Keywords:** API, Jellyfin, retry, configuration, streaming, transcoding, library, search

Complete reference for all `services/jellyfinApi.ts` functions including server connection, video streaming, library navigation, and retry logic.

## Related Documentation

- [`CLAUDE-state-management.md`](./CLAUDE-state-management.md) - State managers using these APIs
- [`CLAUDE-configuration.md`](./CLAUDE-configuration.md) - Configuration management functions
- [`CLAUDE-patterns.md`](./CLAUDE-patterns.md) - Common API usage patterns
- [`CLAUDE-multi-audio.md`](./CLAUDE-multi-audio.md) - Multi-audio transcoding implementation
- [`CLAUDE-security.md`](./CLAUDE-security.md) - API security considerations

---

This document provides a complete reference for all `services/jellyfinApi.ts` functions.

## Configuration Management

| Function          | Purpose                         | Returns         |
| ----------------- | ------------------------------- | --------------- |
| `refreshConfig()` | Reload from SecureStore (async) | `Promise<void>` |
| `waitForConfig()` | Wait for initialization         | `Promise<void>` |
| `isConfigReady()` | Check if config initialized     | `boolean`       |

## Server Connection

| Function                            | Purpose                          | Returns         |
| ----------------------------------- | -------------------------------- | --------------- |
| `connectToDemoServer(clearCaches?)` | Connect to Jellyfin demo server  | `Promise<void>` |
| `disconnectFromDemo()`              | Disconnect and clear credentials | `Promise<void>` |
| `isDemoMode()`                      | Check if using demo server       | `boolean`       |
| `syncDevCredentials()`              | Sync .env.local to SecureStore   | `Promise<void>` |

## Library & Content

| Function                                               | Purpose                | Returns                   |
| ------------------------------------------------------ | ---------------------- | ------------------------- |
| `fetchLibraryVideos(startIndex, limit)`                | Get paginated videos   | `Promise<{items, total}>` |
| `fetchFolderContents(folderId, startIndex, limit)`     | Get folder items       | `Promise<{items, total}>` |
| `fetchPlaylistContents(playlistId, startIndex, limit)` | Get playlist items     | `Promise<{items, total}>` |
| `fetchVideoDetails(videoId)`                           | Get video metadata     | `Promise<VideoMetadata>`  |
| `fetchUserViews()`                                     | Get root library views | `Promise<JellyfinItem[]>` |

## Search

| Function                                 | Purpose                    | Returns                   |
| ---------------------------------------- | -------------------------- | ------------------------- |
| `searchVideos(query, startIndex, limit)` | Search with year filtering | `Promise<{items, total}>` |

## Streaming & URLs

| Function                                       | Purpose                     | Returns           |
| ---------------------------------------------- | --------------------------- | ----------------- |
| `getVideoStreamUrl(itemId)`                    | Direct download URL         | `string`          |
| `getTranscodingStreamUrl(itemId, videoItem?)`  | HLS transcode URL (async)   | `Promise<string>` |
| `getPosterUrl(itemId, maxHeight?)`             | Poster image URL            | `string`          |
| `getFolderThumbnailUrl(itemId, maxHeight?)`    | Folder/collection thumbnail | `string`          |
| `getSubtitleUrl(itemId, streamIndex, format?)` | Subtitle stream URL         | `string`          |

## Utilities

| Function                      | Purpose                       | Returns   |
| ----------------------------- | ----------------------------- | --------- |
| `isCodecSupported(codec)`     | Check native codec support    | `boolean` |
| `needsTranscoding(videoItem)` | Determine if transcode needed | `boolean` |
| `isFolder(item)`              | Check if item is navigable    | `boolean` |
| `isAudioOnly(videoItem)`      | Detect audio-only media       | `boolean` |
| `hasPoster(item)`             | Check if item has poster      | `boolean` |
| `formatDuration(ticks)`       | Ticks to human-readable       | `string`  |

## Subtitles

| Function                              | Purpose                                 | Returns                       |
| ------------------------------------- | --------------------------------------- | ----------------------------- |
| `getTextSubtitleStreams(videoItem)`   | Non-image streams (external + embedded) | `JellyfinMediaStream[]`       |
| `getBurnInSubtitleStream(videoItem)`  | Image-only track needing server burn-in | `JellyfinMediaStream \| null` |
| `isImageBasedSubtitleCodec(codec)`    | PGS/DVDSUB/VobSub/etc.                  | `boolean`                     |
| `getSubtitleUrl(itemId, index, fmt?)` | Plain WebVTT for one stream             | `string`                      |

### How subtitles reach the player

Text tracks ride as HLS renditions whose playlist points at the plain
`/Videos/{id}/{id}/Subtitles/{i}/Stream.vtt` — **no `X-TIMESTAMP-MAP`**, absolute
source times. Jellyfin's own `SubtitleMethod=Hls` rendition stamps every segment
`X-TIMESTAMP-MAP=MPEGTS:900000` (10s), which fMP4 segments starting at 0 do not
honour, so anything on the server HLS path runs 10s late. That is why the
mode-selection gate routes text-subtitle files to the local remux engine.

### Server-side constraints

- A client only ever sees subtitles the scanner attached. `MediaInfoResolver.cs`
  reads two directories (the video's folder + internal metadata), **no
  recursion**, and only attaches files whose name starts with the video's full
  filename followed by a `.`. A `Subs/` subfolder is never read, and no endpoint
  serves a file by path, so the app cannot surface those files.
- Naming (`NamingOptions.cs`): delimiter `.` only; flags `default`,
  `forced`/`foreign`, `cc`/`hi`/`sdh`; extensions
  `.ass .mks .sami .smi .srt .ssa .sub .sup .vtt`. `hi` parses as
  hearing-impaired, not Hindi, unless a language is already set.
- `/Items/{id}/RemoteSearch/Subtitles` returns empty before calling any provider
  unless the item is `Movie` or `Episode`, so it never works in a `homevideos`
  library (everything is `Type: Video`).

## Video Quality Presets

| Preset | Resolution | Bitrate  | Use Case                      |
| ------ | ---------- | -------- | ----------------------------- |
| 480p   | 854×480    | 1.5 Mbps | Slow connections, data saving |
| 540p   | 960×540    | 2.5 Mbps | Balanced quality              |
| 720p   | 1280×720   | 4 Mbps   | HD quality, good bandwidth    |
| 1080p  | 1920×1080  | 8 Mbps   | Full HD, fast connections     |
| 4K     | 3840×2160  | 20 Mbps  | Ultra HD, high bandwidth      |

**Note:** Bitrates are optimized for quality (increased from original 1/1.5/3/5 Mbps values). 4K uses H.264 level 5.1 for optimal encoding at 2160p resolution.

## Implementation Details

- **Retry Logic:** Exponential backoff (3 attempts max)
- **Timeouts:** 10-30 seconds per request
- **Configuration Caching:** Synchronous URL generation
- **Development Fallback:** `.env.local` credentials
