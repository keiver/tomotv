# Changelog

## 1.1.0

- `setPosterQueuePaused(paused)` parks the poster queue's waiting backlog while video plays and returns it on release. The grab already running finishes, a request made while parked still runs, and a cancel reaches a parked job at once. `setPosterFramesPaused` wraps it in JS, and `posterFrameWorkInFlight` stops counting parked jobs.
- `LocalRemuxer.invalidate()` stops the sessions a dying React runtime started, so a Metro reload no longer leaves an orphaned pipeline running.
- A remote VOD input is read through three ranged connections at once, in 2 MB chunks with a window of four, when the server answers a ranged probe with 206 and a total. A refusal or a failed open falls back to the single connection.
- `mergeDownloadParts({ parts, outputPath })` joins ranged download parts into one file and removes a half-joined file on failure; `canMergeParts()` says whether the running binary carries it.
- `liveStarving(samples)`: a live feed whose last three timed segments each arrived slower than they play, each read-bound, with nothing buffered ahead.
- Interlaced H.264 goes through the deinterlacer instead of the copy. A live TS that hides its field order is read to its opening keyframe, and that keyframe's SPS picks the lane.
- A live HLS segment whose open fails is retried three times before it is skipped (`seg_max_retry`).
- The system's memory pressure events are logged with the process's headroom.

## 1.0.2

- Add universal Mac Catalyst slices (Apple Silicon and Intel) to the pinned FFmpeg frameworks, targeting macOS 13.4 or later. VideoToolbox requests Metal-compatible pixel buffers on Catalyst, and Metal shaders target the same OS minimum.
- Support checksum-verified local artifact installation through `TOMO_FFMPEG_ARTIFACTS_DIR` for validation before publishing a release.

## 1.0.1

- An I-frame rendition for scrubbing on every VOD session with video: `#EXT-X-I-FRAME-STREAM-INF` beside the copy, ladder or not. Entries are the demuxer's keyframes where it indexes them (Matroska, WebM, MP4/MOV, AVI), else the segment grid. Each is the keyframe in a fragment of its own over a video-only init, read through a `FrameGrabber` of its own. The rendition is always SDR (HLS authoring spec 6.16): the keyframe is copied for an SDR picture inside 1920x1080 that the session copies, and otherwise encoded as H.264 High 4.0 inside 1920x1080, PQ and HLG tone-mapped to BT.709; Dolby Vision profile 5 gets none. The line declares RFC 8216's peak and AVERAGE-BANDWIDTH, each sample lasts until the next fragment's tfdt, and playlists go out gzip-encoded. A frame that cannot be read is answered with the nearest made one, never a miss.
- `startFrameProvider(inputUrl, itemId, { transcode, durationSeconds })` serves the same rendition for a server stream, on the source's time from its start, and `iframeStreamInf` writes its master line; `startPlaylistShim` appends that line with `iframeStreamInf`.
- MPEG-TS seeks by estimated byte position on a map of known positions, sharpened by every landing and every keyframe read, instead of FFmpeg's timestamp search.
- `searchGuide`: a loaded guide's programmes in a window whose title, sub-title or description carries every word of a query, case and accents folded, matched in the native store; a title's earliest airing per channel, earliest first, up to a limit.
- The TomoEngine, TomoLiveSources and TomoFFmpeg pods target iOS 16.4.
- The input opens a fresh connection per request (no `multiple_requests`), so an MP4 with its moov at the end opens instead of failing on segment 0.
- A subtitle rendition with `isHearingImpaired` carries the accessibility CHARACTERISTICS (HLS authoring spec 4.5).
- A seek no longer aborts the process when copied audio sits behind the keyframe it lands on: audio before the muxer's first DTS is dropped instead of reaching movenc as a negative-duration sample.
- The download rewrap declines for good when any audio track cannot be copied into MP4, instead of dropping it, since the app deletes the source after a rewrap.
- Peer dependency `expo-file-system` >= 19.0.0, the first version whose root exports `File` and `Paths`.
- The TomoFFmpeg pod's license points to the package's `NOTICE.md`.

## 1.0.0

First release, extracted from Tomo TV.

- `TomoEngine` pod: the on-device engine (LocalRemuxer) over FFmpeg and VideoToolbox, serving HLS to the native player from a loopback server.
- `TomoLiveSources` pod: XMLTV guides and M3U playlists loaded and parsed natively, with a public `PlaylistLoader` for an app's own Swift.
- `TomoFFmpeg` pod: the pinned FFmpeg xcframeworks, fetched and checksummed at install.
- Config plugin that places the three pods in the generated Podfile.
- Typed JS API: `startSession` and the session calls, engine events, codec tables, link and origin probes, live frame grabs, poster frames, repackaging, subtitle resolution, image subtitle manifests, CODECS builders, guide and playlist wrappers, `probeInput`.
- A session's stop requests are the app's: the engine fires what it is handed and knows no server route.
- Verdict store: below-realtime measurements per file on this device, under the app's key and build label, held after two agree, 30 minutes.
