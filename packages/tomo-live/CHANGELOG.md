# Changelog

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
