# Changelog

## 1.6.0

- A channel only a hardware tuner carries is never opened for a picture or a neighbour: `resolveOrigin` may answer `"tuner"` (the app's `LiveChannels` contract), the sampler then never grabs it, the focused card warms no preview for it, the ring heats no tuner neighbour and keeps no tuner channel the player left. `noteTunerChannel`, `isTunerChannel`, `tunerChannelKnown` and `clearTunerChannels` (cleared with `clearLiveFrames`).
- `refreshLiveFrameWhilePlaying(channelId, sessionUrl)`: a tuner channel the player plays gets its card's picture read off the player's own engine session, now and every `LIVE_FRAME_REFRESH_MS`, never a second tuner open; a channel not yet known to be a tuner is asked again after `LIVE_FRAME_TUNER_UNKNOWN_RETRY_MS` (5 s). A tuner card no longer holds back the rows partly on screen.
- Multiview: `setLiveTiles(channelIds, { chosen })` keeps the main at playback priority, opened as the player opens it, and the satellites at preview priority without a server open, one open a second apart; a channel in `chosen` (a spot the viewer filled) opens on the server as the player opens it, a hardware tuner included, and is never skipped as unavailable. A satellite falls back to its clip and picture when its provider has no room (refused, or a known limit of 1, or 2 beside the main), for a read-bound segment (the furthest first, one per `LIVE_TILE_DROP_SPACING_MS`), on a memory warning, or when its player fails or finds none free (`noteLiveTileFailed`). A main on a one-connection provider holds the sampler off that provider (`setLiveFrameOriginHold`). The player takes the main's session through `takeLiveTile` and hands it back through `retainLiveTile`; `liveTileUrl`, `liveTileUnavailable`, `subscribeLiveTiles`, `liveTilesVersion`.
- `MULTIVIEW_LAYOUTS`, `multiviewSpots(layout, space)`, `multiviewSpotCount`, `multiviewFeatured`, `multiviewSpotsBottom`, `multiviewChannels(list, mainId, count, skip)` and `keepMultiviewOrder`: five fixed layouts of up to four spots that fill the stage edge to edge with a `gap` line between spots, each in its wide or tall shape, whichever crops the 16:9 pictures least, and the channels around the main in the list.
- `LiveClipView` takes `live`, `muted` and `onFailed`: a live tile plays an engine session through `LowLatencyPlayerAsset`, with sound only when unmuted. The `LiveClip` pod depends on `TomoEngine`.
- The `multiview` surface for the sampler. `startChannelSession` opens a channel's session for the preview and the tiles.
- A channel's start buffer steps through `LIVE_START_STEPS` (2, 6, then 15 s): `noteLiveStall(channelId, playedMs)` steps it up one on a stall within `LIVE_POOR_START_WINDOW_MS` (60 s) of the picture coming up and returns the seconds to hold the picture for, the gap to the next step; `noteLiveCleanStart(channelId)` steps it back down one after a clean minute; `liveStartBufferSeconds(channelId)` is what the channel's next session builds. Kept in memory for the app run. `LivePlayback` waits for the channel's step, at most 20 s past it.
- `@keiver/tomo-engine` 1.8.0 or later, whose `LIVE_BUFFER_SECONDS` (2) is the first step.
- `LivePlayback`'s start wait passes at once for a session that serves LL-HLS (`startBufferedSeconds`), since the engine holds its own first answer.
- `planLiveRecovery` takes `played`: a channel that has not played since the viewer chose it ends after `LIVE_UNPLAYED_REOPENS` (4) reopens instead of reopening every 5 s for as long as the viewer stays. `LiveDropCounter.played` carries it.
- The external guide's log lines name the guide's host and port (`originKeyOf`), never its URL, which can carry the provider's username and password.

## 1.5.0

- `providerStreamsInUse(streamUrl, headers?)`: an Xtream-style provider's own count of the streams the account holds and allows (`active_cons`, `max_connections` from its `player_api.php`), read with no stream opened; null for a stream URL that names no account or a provider without that API. `providerApiUrl(streamUrl)` builds the API address from `/live/{user}/{pass}/{id}` or `/{user}/{pass}/{id}`.
- The frame sampler leaves out a card whose provider a recording holds (`originHeld`) and reads it once the hold ends. The focused card's preview does not start on such a provider, and `isPermanentLiveFailure` takes the engine's recording hold (`isRecordingHoldFailure`) as permanent, so a held channel is not opened again.
- On a provider set to one connection (`originConnectionLimit` is 1), the ring resolves and starts no neighbour and keeps no channel the player left, so nothing takes the slot the next channel opens on, through the server or straight from the provider. `channelOnOneConnection(channelId)` reads that off the channel's playlist row.
- `planLiveRecovery`, `liveReopenCount`, `isPermanentLiveFailure`, `LIVE_REOPEN_DELAYS_MS` and `LIVE_RECOVERY_RESET_MS`: a dropped channel opens again after 0.5, 1, 2, 4, then 5 s for as long as the viewer stays on it, counted from zero once it has been playing 60 s since it last started, and stops only on a failure no open fixes.
- `LiveDropCounter` (`notePlaying()` starts the playback clock a drop is measured against) and `watchLiveSession(token, drops, { onReopening, onReopened, onEnded })`: a live session followed for its whole life, its in-session reopens and the failure that ends it, with the recovery decision.
- `LivePlayback`: one channel's play. `play(channelId, { onUrl, onState, onDrop, onEnded, startSession, prepare, onOpened }, { opened })` runs it whole: a ring or preview session taken over, else the channel opened (`openChannel`) and its session started, the app's `prepare` step before each bind (`false` ends the play with no bind), each drop answered after the planned wait with a new URL, until `stop()`, `release(keepHot)` or a failure no open fixes (the `isPermanent` dep adds the app's own); `fail(message, permanent, decided, cause)` is the player's own error, and `state` is `idle`, `opening`, `buffering`, `playing`, `reopening` or `failed`. The steps underneath are public for an app with its own between them: `open(channelId, current)` (nothing opened or left open for an attempt the viewer left, and a newer attempt's ring session left running), `acquire`, `takeAdopted`, `opened`, `abandon`, `bind`, `drop`, `retryDelayMs`, `reopenAfterWait`, `cancelWait`, and `release`, which hands a channel that played to the ring or closes it.
- `channelOrigin` gains the origin rules from the app: `splitPipeHeaders`, `originKeyOf`, `mergeOriginHeaders`, `drmKeyFormat`, `dashProtection`, `manifestDrm`, `originReach`, `isOriginLaneAvailable` and `resetOriginReach`.
- `@keiver/tomo-engine` 1.4.0 or later, for `subscribeEngineLive` and the live start buffer.

## 1.4.0

- A ring neighbour the engine ended for its provider's budget (`isConnectionBudgetFailure`) is released without the ten-minute cold mark a dead channel gets, so it heats again the next time a connection is spare.
- Channel health no longer strikes a channel for HTTP errors other than 404, including 400: the engine reports those as `refused`, which does not count as evidence the channel is down. Two 404 open failures still count for a down verdict.
- `playlistOrigins()`: every provider host across the sources in first-seen order, with how many channels read it and which sources list it, so a limit set per source reaches every host that source reads.
- Every card fights for its clip, with timed backoff from its second failure in a row. One deadline, `LIVE_FRAME_DEADLINE_S` (15 s), for every grab; `LIVE_FRAME_COLD_DEADLINE_S` is gone. A grab the provider turned away for its whole fight (the engine's `refused` answer) or that found no connection spare (`busy`) strikes no channel: it counts as a failure of the card, so the card goes behind the cards that never failed, and a grab served by the provider makes its refused cards due again, each at its last try, their failure count kept. A card with a picture and no clip stays due, behind the cards with no picture (`clipAsked` is gone); a grab that brings pictures and no clip counts as a failure of the card, so a channel too slow for its clip waits the ladder from the second. `LIVE_FRAME_REFUSED_REST_MS`, `LIVE_FRAME_REFUSED_REST_CAP_MS` and `LIVE_FRAME_BUSY_WAIT_MS` are gone.
- A card's first failure costs it no wait, only its place in line: it is due at its last try, behind the never-failed cards and the refreshes due before it, never at the front; from the second in a row it waits `LIVE_FRAME_RETRY_MS`, doubling to the cap. `LIVE_FRAME_RETRY_FIRST_MS` is gone.
- `noteChannelOpenFailure(channelId, failure, ended)`: an open the origin admitted and ended itself (the engine's `ended`) strikes the channel like a definitive HTTP refusal, two for a down verdict. A channel judged down reads only once every other card in view is done, is never put first by focus, and gets no preview; a burst still redeems it.
- Only a grab the origin served makes its refused siblings due again; an open admitted and never served (`reason: "open"`) brings nothing back.
- The focused card's preview warms once the card has a picture (at the dwell when it already has one, else when its grab serves), never beside an unserved grab of the same channel.
- Among the cards due now: no picture before no clip, never-failed before failed, the one that tried longest ago first, then nearest the focused row.
- The card focused past the dwell reads before any other while its burst is older than `LIVE_FRAME_FOCUS_REFRESH_MS`: the dwell stops the grab of any other card, and while it is read only a card known to read another provider reads beside it; the others read while it is fresh or while it waits out a failure.
- `setLiveFrameViewable(surface, channelIds, partlyShownIds)` takes the rows only partly on screen: they are read once no whole row is reading, due for its picture or clip, or due its refresh, and a whole row waiting out a failure holds none of them back.
- The Mac Catalyst app plays up to 48 clips at once: the player pool checked `isiOSAppOnMac`, which only an iPad app on a Mac reports, and capped the Catalyst build at 16. It checks `isMacCatalystApp`, which both report.
- A clip player is one `AVPlayer` item sought back to its start at each end, no `AVPlayerLooper`: the looper's item churn logged a CoreMedia `signalled err` line per seam and six per clip swap (measured on a Mac, 30 players flooded the unified log until the system quarantined the process); the one-item loop logs none per seam and two per swap. The newer clip still takes over at the seam.
- `@keiver/tomo-engine` 1.3.0 or later, for `isConnectionBudgetFailure` and the grab's `refused` answer.

## 1.3.0

- A playlist channel carries its archive and its guide shift: `catchup` (`type`, `source`, `days`) and `tvgShift` on `PlaylistChannel`, each value the channel's own over the playlist header's, and absent when neither declares one. `playlistChannelFromEntry(entry, id, header?)` takes the header; `enginePlaylistRows` passes it.
- Guide and playlist downloads give the link to playback, and no read waits on the network while `setPlaybackHold` is held. A read gets the copy on disk at once, or `PlaybackHoldError` when there is none. The download it needs (stale, forced, or missing) runs once the hold has been free for 2 s. A caller already waiting on a download when playback starts gets the copy, or `PlaybackHoldError`, at that moment.
- A download running when playback starts pauses at once and resumes from its bytes after, or starts over when the server gave no resume data. A pause sent before the task reported bytes can reach native before the task exists, so it is sent again at the first bytes seen during the hold; when the first one had taken, that second pause can cost the resume data and a restart after playback.
- `onGuideFileRefreshed(listener)` and `onPlaylistFileRefreshed(listener)` run with the URL once a download that playback held back has finished. An open guide is tied to the file it was parsed from and reopens when a newer file is on disk; a guide asked for during playback opens once its file downloads, and `subscribeGuideRefreshed(listener)` tells screens to read again. A playlist read before the newer file reloads on the next `syncPlaylistSources`, and a sync that arrives while the old file is still being read loads the playlist once more after it.
- A guide whose file has not downloaded yet reports `paused` during playback and `waiting` after it; a playlist reports `waiting`. Neither counts as a failure, so no backoff delays the next read.
- `cachedGuideFile` and `cachedPlaylistFile` take `headers`; `enginePlaylistRows` sends the source's headers with the download, not only the parse.
- On a memory warning every open guide is closed (one being read closes when the read ends) and opens again at the next read. The "External guide loaded" log line adds app memory before the load and at its peak.
- `configureLive({ guideChannels })`: the app lists every channel it can ask a guide about (`GuideChannelCandidate`: `channelId`, tvg keys, and every name it asks by), and a guide keeps only those channels' programmes. A read asking about a channel or name the list lacks opens the guide again with it added, and later loads keep it. Without the list, or when it answers null, a guide keeps every channel. The log line adds `appChannels`, `unmatchedSkipped` and `passes`.
- `expo-file-system` 56.0.0 or later, for `File.createDownloadTask`.
- `@keiver/tomo-engine` 1.2.0 or later, for `loadGuide`'s channel list and its memory figures.

## 1.2.0

- Playlist channels: a channel table built from M3U playlists parsed on device (`syncPlaylistSources`, `playlistChannelById`, `playlistChannelsPage`, `playlistGroupList`, per-source statuses). Identity is the app's own; `enginePlaylistRows` is the stock loader over the engine's native store, paged 1000 entries per native call. A failed reload serves the last good rows and backs off.
- The guide file cache generalizes to playlists: `cachedPlaylistFile`, `playlistFileInfo`, `playlistCacheBytes`, `clearPlaylistFileCache`, the same atomic download, stale-on-failure and sweep rules in a `playlists/` folder.
- `fetchExternalAiring(urls, channels, atMs)`: the programme airing at a moment on each channel, read from the guides already open over it. It never opens a guide: one still loading, or whose window has passed, is skipped. `fetchExternalListingWindow` takes `{ openOnly: true }` for the same read over any window.

## 1.1.0

- `isPlaybackHeld(owner?)` answers for one owner, and `onPlaybackHoldChange` fires on every owner joining or leaving, so work can react to the video hold specifically while audio plays on.
- `liveFrameDueAt(channelId)`: when the sampler means to read a channel again. Listeners hear when a focus promotion or an unchanged verify moves it.
- A memory warning stops the live preview's warm session and cools the ring's neighbours; the playing session stays.
- One open guide per URL serves every window: a load takes the union of the open window and the asked one, and a retired guide's token closes when its last in-flight read ends.

## 1.0.1

- `searchExternalListings`: the guide sources' programmes in a window matching every word of a query, asked of each guide in order for the channels earlier guides did not pair, through the engine's `searchGuide`. Requires `@keiver/tomo-engine` 1.0.1.
- Peer dependency `expo-file-system` >= 19.0.0, the first version whose root exports `File`, `Paths` and `Directory`.

## 1.0.0

First release, extracted from Tomo TV.

- `configureLive`: the app's channels (resolve, open, close, engine session start, list changes) as the one injection point.
- Live ring: neighbours of the playing channel kept hot in the engine during a surf window, handed to the player on a flip.
- Live preview: the focused card's warm session, adopted by the player on play.
- Live frames: frame bursts and preview clips for the cards in view, one channel at a time, with backoff and a provider-cap rest.
- Channel health from the grabs' own outcomes, and the open-failure memo.
- XMLTV guide sources: on-disk cache keyed by URL, tvg-id then name matching, per-guide status.
- `LiveClip` Expo module: a muted looping clip view from a pool of preview players.
