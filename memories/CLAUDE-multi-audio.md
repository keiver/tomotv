# Multi-Audio Track Switching

**Last Updated:** January 24, 2026

## Quick Reference

**Category:** Implementation
**Keywords:** multi-audio, Swift, HLS, transcoding, audio tracks, native module, manifest

Seamless multi-audio track switching during transcoding using custom Swift module with HLS manifest generation.

> **Scope: the SERVER transcode lane only.** Everything below describes
> `MultiAudioResourceLoader`, which rewrites Jellyfin's HLS manifest so a
> server-transcoded file can carry several audio renditions. The on-device
> engine has its own, unrelated implementation: it de-muxes each carriable
> track into its own rendition directly (`Remuxer.masterPlaylist`), which is
> why switching there needs no manifest rewriting and no restart. Both lanes
> report `isSeamlessMode` to `useVideoPlayback`. See
> [`CLAUDE-playback-engine.md`](./CLAUDE-playback-engine.md) for the engine's.

## Related Documentation

- [`CLAUDE-playback-engine.md`](./CLAUDE-playback-engine.md) - the on-device engine's own audio path
- [`CLAUDE-api-reference.md`](./CLAUDE-api-reference.md) - Transcoding API functions
- [`CLAUDE-external-dependencies.md`](./CLAUDE-external-dependencies.md) - Swift module architecture
- [`CLAUDE-patterns.md`](./CLAUDE-patterns.md) - Multi-audio implementation patterns
- [`CLAUDE-lessons-learned.md`](./CLAUDE-lessons-learned.md) - Audio track debugging cases

---

**Seamless Multi-Audio Track Switching**

TomoTV provides seamless audio track switching during transcoding through a custom Swift native module. This feature works like Apple TV+, Netflix, and Disney+ - no video restarts, no interruptions, just instant audio switching.

## How It Works

### Technical Implementation

TomoTV uses a custom Swift module (`MultiAudioResourceLoader`) that intercepts HLS manifest loading and generates proper multivariant playlists client-side:

1. **Detection:** When a video with multiple audio tracks needs transcoding, TomoTV detects this in `useVideoPlayback` hook
2. **Manifest Fetching:** Custom Swift module fetches individual Jellyfin HLS manifests for each audio track
3. **Manifest Generation:** Combines all manifests into a single multivariant HLS playlist with proper `#EXT-X-MEDIA` tags
4. **Custom Protocol:** Uses `jellyfin-multi://` protocol to trigger the custom resource loader
5. **Native Discovery:** AVPlayer discovers all audio tracks from the combined manifest
6. **Seamless Switching:** User can switch between tracks during playback without interruption

### User Experience

- **Native iOS/tvOS audio picker** shows all available audio tracks
- Track labels display language, codec, and channel info: "ENGLISH (AC3 5.1)", "SPANISH (AAC STEREO)"
- **Switching is instant and seamless** - no video restart, no buffering delay
- Uses the same native UI and switching behavior as Apple TV+, Netflix, and Disney+
- Respects user's language preferences and device settings
- **Works during transcoding** - no need for direct play compatibility

### Subtitles (Native Toggleable Tracks)

- `SubtitleMethod=Hls` parameter tells Jellyfin to include ALL subtitle tracks in the HLS manifest
- Includes both external (.srt files) AND embedded subtitle streams
- Each subtitle appears as a separate WebVTT stream in the manifest
- react-native-video auto-discovers tracks from HLS `#EXT-X-MEDIA:TYPE=SUBTITLES` tags
- Native iOS/tvOS controls provide subtitle selection UI (same as Apple TV+)
- **Fully toggleable:** Users can switch between subtitles or disable entirely during playback
- **No burning:** Subtitles are rendered as overlay, not burned into video frames
- Zero performance impact when disabled

### API Functions

- `getSubtitleTracks(videoItem)` - Returns array of subtitle tracks (both external and embedded)
- `getAudioTracks(videoItem)` - Returns array of audio tracks with full metadata
- `prepareMultiAudioPlayback(videoId, videoItem, baseUrl, apiKey)` - Prepares multi-audio custom protocol URL
- `shouldUseMultiAudio(videoItem)` - Checks if video should use multi-audio loader
- `isMultiAudioAvailable()` - Checks if native module is available (iOS/tvOS only)

## Technical Achievement

### The Challenge

The standard approach with HLS transcoding is to generate a single manifest per video with one audio track selected. When users want to switch audio:

1. Stop video playback
2. Request new manifest with different audio track
3. Restart video (potentially from timestamp)
4. Re-buffer and reload

This creates an interruption in the viewing experience.

### TomoTV's Solution

TomoTV generates a **multivariant HLS manifest** with ALL audio tracks as separate streams. This allows:

- ✅ **Instant switching** - AVPlayer discovers all tracks at once and switches in real-time
- ✅ **No interruption** - Video continues playing without restart or rebuffering
- ✅ **Native UI** - Uses iOS/tvOS native audio picker (same as Apple TV+, Netflix)
- ✅ **Respects settings** - Track selection persists and follows user preferences

### Technical Innovation

This required custom Swift implementation because Jellyfin's API doesn't natively support multivariant playlists. TomoTV's approach:

1. Fetches individual HLS manifests for each audio track
2. Combines them client-side into a multivariant playlist
3. Uses `AVAssetResourceLoaderDelegate` to intercept manifest loading
4. Serves the combined manifest to AVPlayer
5. AVPlayer discovers all tracks and enables seamless switching

### User Experience

The result is seamless audio switching that works like premium streaming services.

## Technical Details

### Swift Module Structure

```
ios/MultiAudioResourceLoader/
├── MultiAudioResourceLoader.swift      # AVAssetResourceLoaderDelegate
├── HLSManifestParser.swift            # Parse Jellyfin manifests
├── HLSManifestGenerator.swift         # Generate multivariant manifest
├── MultiAudioResourceLoader.m         # React Native bridge
└── MultiAudioResourceLoader-Bridging-Header.h
```

### Custom Protocol Flow

1. TypeScript detects multi-audio video during transcoding
2. Calls `prepareMultiAudioPlayback()` to configure native module
3. Native module generates `jellyfin-multi://...` URL
4. AVPlayer loads URL → triggers `AVAssetResourceLoaderDelegate`
5. Delegate fetches all Jellyfin manifests in parallel
6. Combines into multivariant playlist with all audio tracks
7. AVPlayer discovers tracks and enables native picker

### Example Generated Manifest

```m3u8
#EXTM3U
#EXT-X-VERSION:3

# Audio tracks
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="ENGLISH (AC3 5.1)",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="..."
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="SPANISH (AAC STEREO)",LANGUAGE="es",AUTOSELECT=YES,URI="..."
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="FRENCH (DTS 7.1)",LANGUAGE="fr",AUTOSELECT=YES,URI="..."

# Video stream with audio group reference
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1280x720,AUDIO="audio"
http://jellyfin:8096/Videos/abc123/video.m3u8?api_key=...
```

### Fallback Behavior

- **Single audio track:** Uses regular transcoding (no custom protocol overhead)
- **Direct play:** All audio tracks available natively (no custom protocol needed)
- **Non-iOS platforms:** Feature not available (iOS/tvOS only)
- **Module not available:** Falls back to regular transcoding gracefully

## Why This Matters

- **Families with different language preferences** can each watch in their preferred language
- **International content** (anime, foreign films) with multiple audio options
- **Accessibility** for users who need different audio tracks
- **Familiar UX** - Audio switching behaves like users expect from premium streaming apps
- **Technical innovation** - Custom Swift implementation with AVPlayer integration for seamless switching
