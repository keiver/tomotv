# Changelog

## 1.3.0

- On tvOS, iOS and macOS 26 and later the preferred audio track, when it is TrueHD with an Atmos presentation or DTS-HD MA carrying DTS:X, becomes APAC 7.1.4 through SpatialAudioBridge 2.0, on an audio-only rendition with its own 3.2 s grid. A session's first second is decoded by `SpatialAudioCodec.probe(_:)` before the encoder sees it, once per track per process, so plain DTS-HD MA goes back to FLAC without an encoder. `.unsupported` and `.invalidConfiguration` refusals and a conversion slower than realtime are remembered for the process, before any engine verdict; `.decoding` costs only the session. A `.discontinuity`, a timestamp jump or a decoded format change, starts a new session at the segment it interrupted, padded with silence; one in the last packets sends the track to FLAC.
- SpatialAudioBridge's core is the dynamic `SpatialAudioCore.framework`; CocoaPods' embed phase copies and signs it into the app.
- `SpatialAudioOutput.follow(_:id:)` and `release(id:)`: the library's `AtmosOutputActivator` follows the player while a spatial rendition is selected, on iOS outside AirPlay, which sends the track back to FLAC.
- `spatialAudioNotices()` resolves SpatialAudioBridge's license notices, with those of its decoders, Rust crates and the Rust standard library.
- An engine failure carries `spatialAudio` when a track the master named APAC goes back to FLAC; reopening the engine plays it as FLAC.

## 1.2.0

- FFmpeg tomo.8: the `dec3` box of a copied E-AC-3 track takes its Atmos flag from the dependent substream when the stream has one (ETSI TS 103 420 8.3.1). A Blu-ray style track, an AC-3 core with a dependent E-AC-3 frame carrying the objects, used to be declared without Atmos because the muxer read the first frame of each packet. On Apple TV with AirPods, Control Center shows Dolby Atmos for such a track.
- `describesInput` on a session config: the engine reads the variant off the open input (VIDEO-RANGE from the transfer and the Dolby Vision record, RESOLUTION, FRAME-RATE, SUPPLEMENTAL-CODECS, the container's bit rate) and whichever of `audioTracks`, `subtitles` and `durationSeconds` the config leaves empty. Every audio stream becomes a rendition with the file's default-flagged one first; text and image subtitle tracks are listed, a language's full track before its SDH and forced ones, and a track no decoder opens is left out. The master waits for the input and for the primary init, so CODECS is the tag read off the init. It takes no `tiers` and no `serverVideoOnly`. `describedSessionConfig({ inputUrl, itemId, httpHeaders?, startOffsetSeconds?, originKey?, inputConnections? })` builds that config.
- `inputSubtitleRenditions(token)` returns the subtitle tracks a live or self-described session read off its input, with `isEngineText` and `isHearingImpaired`. `liveSubtitleRenditions` is the same function.
- `setOriginConnectionBudget(originKey, connections)` sets how many connections a provider allows this device, for every read that names it; 0 forgets the limit. `originConnections(originKey)` reads the limit in force, set or learned, and the connections open on it.
- A file session that names its provider (`liveOriginKey`) takes a lease per connection. `inputConnections` is how many its input may read over (3 when absent, 16 at most); under a provider key it opens as many as the budget spares and never fewer than one. A refusal by the provider while this device holds other reads on it teaches the limit, the lower reads yield, and the input opens on the one connection.
- A single connection reads through the ranged reader too. Read through FFmpeg's own HTTP, a one-connection test origin served two bodies at once; through the reader it serves one.
- A session's chapter frames and I-frame rendition each take a lease on its provider's budget and open only on a spare connection. With none spare when the session plans its video, the master names no I-frame rendition. Both now send the session's `httpHeaders`.
- `posterFrame` takes `httpHeaders` and `originKey`: on a provider's budget a poster reads only on a spare connection, never waits for one, and closes before the next poster runs. `requestPosterFrame` passes both.
- `GuideProgramme` types `episodeNumbers`, `isNew` and `previouslyShown`, which the bridge already sent.
- A guide or playlist load stops when less than 256 MB is left before the system's memory limit (`os_proc_available_memory`), and fails with a memory error instead of letting the system kill the app. Where no limit is reported (macOS) loads run as before.
- `loadGuide` stats pass on `footprintBeforeBytes` and `peakFootprintBytes` beside `footprintAfterBytes`.
- `loadGuide(url, window, pool, maxOpen, channels)`: given the app's channels (`{ tvgId?, tvgName?, names }`), a guide keeps only the programmes of guide channels they pair with, by the three passes of tomo-live's `guideMatch` (any pass, any name). Other programmes are skipped at their opening tag, so their text is never read in. Every channel entry is still kept. The XMLTV DTD lists channels before programmes; a file that lists a channel after programmes skipped for it is read a second time with the full channel list. Stats add `unmatched` (programmes skipped this way) and `passes`.
- From Tomo TV's player, unchanged: the session start helpers (`createPreflightGate`, `stillPullingInput`, `engineStillReading`, `nextLinkCap`, `forwardBufferFor`, `linkAffordsChapterFrames`, `keptForReason`, `EngineInputMissingError`) and their timing constants; the playback error IDs (`PLAYBACK_ERROR_IDS`, `IdentifiedError`, `errorIdOf`, `nativeErrorOf`, `formatErrorRef`); `deviceDecodes`; `isImageBasedSubtitleCodec`; the subtitle and audio language rules (`canonicalLanguage`, `knownLanguage`, `observedFromReport`, `nextPreference`, `selectedTextTrackFor`, `subtitleShownFor`, `preferredAudioStreamIndex`, ...). `ImageSubtitleOverlay` draws bitmap subtitles over the player; it is imported from `@keiver/tomo-engine/src/imageSubtitleOverlay`, so the main entry never loads `expo-image`. Peer dependencies add `react` and `expo-image`.
- A Matroska seek over FFmpeg's HTTP whose request times out reports success while the read stays on the old connection (`matroska_read_seek` ignores the failed `avio_seek`). The restart, the cue-loading seeks to the start, chapter frames and I-frames repeat such a seek, up to twice, until the read sits on its cue's cluster.
- A VOD session feeds only the tracks in play at start: the playing audio track, every copied track, and the subtitle tracks flagged default or forced or marked `isSelected`. Every track is still in the master. A segment, playlist, window or cue request for another track is the pick: one restart at the segment asked for, with no segment another track already holds rewritten. `prepareRemainingTracks(token)` brings the remaining converted audio tracks up one per segment, at a cut; it returns false where the binary lacks the method or the session is gone. Subtitle tracks are never brought up this way. Live and self-described sessions feed every track.
- `EngineTierConfig.stopRequest`: the request that ends a rung's own server transcode. A rung the player left, idle 12 seconds with two segments served elsewhere and no fetch of its own running, gets it on the stop schedule; a request for the rung again opens it cold at the playhead. At open one rung is proved and another rung's init answers 503 until the opening segment has landed.
- The subtitle config loses `serverVttUrl`, and `serverSupUrl` names the server's raw copy of an image sidecar only. A track inside the file is read from the input alone; under a rung it draws nothing until the input is read again. A session's server rungs carry no subtitle renditions.
- The opening link probe reads over the input's three ranged connections, each its own range, summed; a probe beside a rung mid-session keeps one connection.
- A ranged read with no byte on any connection for 5 seconds drops its fetches and starts them again on fresh connections, as a seek does; the 20 second read timeout stays the cap.
- Finished segments are written on a serial queue off the pipeline thread, one in flight. A segment counts as produced while its file lands wherever a restart is decided.

## 1.1.0

- `setPosterQueuePaused(paused)` parks the poster queue's waiting backlog while video plays and returns it on release. The grab already running finishes, a request made while parked still runs, and a cancel reaches a parked job at once. `setPosterFramesPaused` wraps it in JS, and `posterFrameWorkInFlight` stops counting parked jobs.
- `LocalRemuxer.invalidate()` stops the sessions a dying React runtime started, so a Metro reload no longer leaves an orphaned pipeline running.
- A remote VOD input is read through three ranged connections at once, in 2 MB chunks with a window of four, when the server answers a ranged probe with 206 and a total. A refusal or a failed open falls back to the single connection. The opening probe and a read waiting on a chunk end when their session stops or fails.
- `mergeDownloadParts({ parts, outputPath })` joins ranged download parts into one file and removes a half-joined file on failure; `canMergeParts()` says whether the running binary carries it.
- `liveStarving(samples)`: a live feed whose last three timed segments each arrived slower than they play, each read-bound, with nothing buffered ahead.
- Interlaced H.264 goes through the deinterlacer instead of the copy. A live TS that hides its field order is read to its opening keyframe, and that keyframe's SPS picks the lane.
- A live HLS segment whose open fails is retried three times before it is skipped (`seg_max_retry`).
- The system's memory pressure events are logged with the process's headroom.
- A WebVTT segment of an engine text track whose window starts before the running read, with no seek or waiting media request headed back to it, is answered with a cue-less body after 0.5 seconds. AVPlayer asks for a segment two behind the playhead when the rendition changes, which after a resume is such a window, and the request used to wait 25 seconds and return 503.

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
