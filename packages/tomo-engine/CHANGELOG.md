# Changelog

## 1.0.0

First release, extracted from Tomo TV.

- `TomoEngine` pod: the on-device engine (LocalRemuxer) over FFmpeg and VideoToolbox, serving HLS to the native player from a loopback server.
- `TomoLiveSources` pod: XMLTV guides and M3U playlists loaded and parsed natively, with a public `PlaylistLoader` for an app's own Swift.
- `TomoFFmpeg` pod: the pinned FFmpeg xcframeworks, fetched and checksummed at install.
- Config plugin that places the three pods in the generated Podfile.
- Typed JS API: `startSession` and the session calls, engine events, codec tables, link and origin probes, live frame grabs, poster frames, repackaging, subtitle resolution, image subtitle manifests, CODECS builders, guide and playlist wrappers, `probeInput`.
- A session's stop requests are the app's: the engine fires what it is handed and knows no server route.
- Verdict store: below-realtime measurements per file on this device, under the app's key and build label, held after two agree, 30 minutes.
