# TomoTV Roadmap: Release Plan

> Plan of record, status as of 2026-11-06: 2.2.14 on the App Store, 2.2.15
> merged to main. Nothing in it is fixed: reorder, drop or add as demand shows.
> Each release gets its own implementation plan and harness/device
> verification when it starts. A user issue outranks a numbered release.

## Positioning sentence

**"Dolby Vision and nearly every codec, inside Apple's own player. No
subscription, AirPlay included."**

Anything AVPlayer already does well (playback speed, scrubbing, the transport
bar, caption style settings) is not a feature we build; we ship the file into
the player and let the player be the player.

## Status board (2026-11-06)

Every item the plan or a shipped release has named. Version is the one whose
changelog carries it. Implemented means merged to main, not yet on the App Store.

| Area      | Item                                                                        | Status      | Where                                                |
| --------- | --------------------------------------------------------------------------- | ----------- | ---------------------------------------------------- |
| Engine    | H.264/HEVC stream copy from any container                                   | Shipped     | 2.0.0                                                |
| Engine    | VideoToolbox transcode for legacy codecs                                    | Shipped     | 2.0.0, widened 2.1.0 (DivX 3, Theora, DV, VVC, Real) |
| Engine    | Any resolution on device, realtime gate, per-file memory                    | Shipped     | 2.2.2                                                |
| Engine    | 10-bit HEVC probe, 8-bit fallback                                           | Shipped     | 2.2.3                                                |
| Engine    | AV1 software decode lane                                                    | Shipped     | 2.2.3                                                |
| Engine    | HDR10 / HLG passthrough                                                     | Shipped     | 2.0.0                                                |
| Engine    | Dolby Vision 8.1 / 8.4 stream copy                                          | Shipped     | 2.2.0, device-verified                               |
| Engine    | Dolby Vision profile 7 to 8.1 on the fly                                    | Shipped     | 2.2.0, device-verified                               |
| Engine    | Dolby Vision profile 5                                                      | Non-goal    |                                                      |
| Engine    | Multi-audio switching, seamless                                             | Shipped     | 1.2.0, on the engine 2.0.0                           |
| Engine    | DD / DD+ / Atmos passthrough                                                | Shipped     | 2.1.0, device-verified                               |
| Engine    | TrueHD, DTS-HD MA, PCM, FLAC lossless, 7.1, 24-bit                          | Shipped     | 2.1.0                                                |
| Engine    | Adaptive Auto quality, link measured per server                             | Shipped     | 2.1.0                                                |
| Engine    | Server rung proved before it is offered                                     | Shipped     | 2.2.3                                                |
| Engine    | Slipstream: copy and the rung ladder in one master, link measured           | Shipped     | 2.2.7                                                |
| Engine    | Server transcoding setting: When needed, Only for unsupported files, Off    | Shipped     | 2.2.10                                               |
| Engine    | Stall recovery, seek timestamp repair                                       | Shipped     | 2.1.0, 2.2.3                                         |
| Engine    | Native scrub previews (I-frame playlist)                                    | Shipped     | 2.2.10, every lane                                   |
| Engine    | One-request seeks on MPEG-TS (byte-estimated)                               | Shipped     | 2.2.10, 1 to 3 seeks                                 |
| Engine    | Originals read over three ranged connections                                | Shipped     | 2.2.11                                               |
| Engine    | Play starts sooner from an item page, early stop of the startup speed check | Implemented | 2.2.15                                               |
| Engine    | Host-side engine tests, codec coverage measured                             | Shipped     | `npm run test:engine`, 59/110 proven                 |
| Subtitles | Text subtitles as HLS renditions                                            | Shipped     | 2.0.0                                                |
| Subtitles | Image subtitles (PGS, VobSub, DVB, XSUB) on device                          | Shipped     | 2.1.0                                                |
| Subtitles | Subtitle choice remembered between items                                    | Shipped     | 2.1.0                                                |
| Subtitles | Audio and subtitle choice saved to the Jellyfin account                     | Shipped     | 2.2.8                                                |
| Subtitles | Find Subtitles: the server's search and OpenSubtitles                       | Shipped     | 2.2.14, Tomo's own key, optional viewer sign-in      |
| Subtitles | Subtitle timing steps, Sync to audio                                        | Shipped     | 2.2.14                                               |
| Subtitles | Secondary subtitles                                                         | Open        | second ring                                          |
| Subtitles | The file's own ASS/SSA styling (issue 113)                                  | Open        | second ring                                          |
| Player    | Skip Intro / Skip Credits buttons on Apple TV                               | Shipped     | 2.1.0                                                |
| Player    | Commercial skipping                                                         | Shipped     | 2.2.9                                                |
| Player    | Skip Automatically per segment kind                                         | Shipped     | 2.2.14                                               |
| Player    | Native chapters in the tvOS info panel                                      | Shipped     | 2.2.1, device-made images 2.2.2                      |
| Player    | Native Up Next card and Up Next tab                                         | Shipped     | 2.1.0                                                |
| Player    | Favorite and Record from the Apple TV player controls                       | Shipped     | 2.2.9                                                |
| Player    | Picture in Picture (iPhone/iPad)                                            | Shipped     | 2.0.0                                                |
| Player    | Music queue: gapless, background, Now Playing, mini player                  | Shipped     | 2.1.0, mini player 2.2.0                             |
| Player    | Lyrics: synced lines, lrclib.net lookup, on-device timing, saved to server  | Shipped     | 2.2.12, maintenance only                             |
| Player    | Photo viewer: slideshow, gestures, share                                    | Shipped     | 1.6.0, gestures and share 2.2.1                      |
| Player    | Book reader: PDF, EPUB, MOBI, AZW, comics                                   | Shipped     | 2.2.6                                                |
| Player    | Playback speed                                                              | Non-goal    | AVPlayer owns it                                     |
| Player    | Custom controls / overlay chrome                                            | Non-goal    | presented AVKit is the product                       |
| Library   | Downloads: originals, offline play, folders, storage gauge                  | Shipped     | 2.2.0 (iPhone/iPad)                                  |
| Library   | Download sizes: original or a 1080p, 720p, 480p server copy                 | Shipped     | 2.2.10                                               |
| Library   | Large originals downloaded in ranged parts                                  | Shipped     | 2.2.11                                               |
| Library   | Offline progress queued and synced                                          | Shipped     | 2.2.0                                                |
| Library   | Offline mode: You're offline, opens Downloads                               | Shipped     | 2.2.14                                               |
| Library   | Item detail: long-press info panel with overview and cast                   | Shipped     | 2.1.0                                                |
| Library   | Playback Info / Diagnostics, Send to iPhone                                 | Shipped     | 2.2.1, 2.2.2, 2.2.3                                  |
| Library   | Continue Watching next-up, binge queue                                      | Shipped     | 2.0.0                                                |
| Library   | Top Shelf (tvOS)                                                            | Shipped     | 2.0.0, live channels 2.2.9                           |
| Library   | Sort & Filter: favorites, genre, artist, year, every server sort order      | Shipped     | 1.7.0 filters, 2.2.14 sort                           |
| Library   | Random order play (shuffle)                                                 | Shipped     | 1.7.0 filters, 2.2.0 download folders                |
| Library   | Keyframe artwork, folder collages, season poster fallback                   | Shipped     | 2.2.2                                                |
| Library   | Delete an item from the server (admins)                                     | Shipped     | 2.2.9                                                |
| Library   | Shows tree: seasons and episodes surface                                    | Partial     | opens as Series and Season folders, no show screen   |
| Library   | Jellyseerr discover and request                                             | Open        | second ring, no measured demand                      |
| Library   | Multiserver View                                                            | Open        | 3.0.0                                                |
| Library   | Deep links (`tomotv:///player?videoId=`)                                    | Shipped     | 2.0.0 Top Shelf; works from any caller, undocumented |
| Library   | Trakt scrobbling                                                            | Open        | second ring                                          |
| Live TV   | Guide, DVR, channels through the engine                                     | Shipped     | 2.2.6                                                |
| Live TV   | Channel wall, live preview frames, favorites                                | Shipped     | 2.2.7                                                |
| Live TV   | Groups, XMLTV guide sources, Live TV search, channel health                 | Shipped     | 2.2.9                                                |
| Live TV   | Preview clips on cards, REC marks, Live TV tab on Apple TV                  | Shipped     | 2.2.9                                                |
| Live TV   | Day strip, programme info panel and recording timers                        | Shipped     | 2.2.10                                               |
| Live TV   | M3U group edits, server XMLTV providers, playlist channels before ingest    | Shipped     | 2.2.11                                               |
| Live TV   | Connection limits per provider, recordings first at a limit of one          | Shipped     | 2.2.13                                               |
| Live TV   | Rename and hide channels                                                    | Shipped     | 2.2.14                                               |
| Live TV   | Multiview, up to four channels                                              | Implemented | 2.2.15                                               |
| Live TV   | Pinned channel above the guide (iPhone, iPad, Mac)                          | Implemented | 2.2.15                                               |
| Live TV   | Faster live start, longer buffer after an early stall                       | Implemented | 2.2.15                                               |
| Accounts  | Saved sign-ins, per-account DeviceId, Continue as, Switch Server            | Shipped     | 2.1.0                                                |
| Accounts  | Who's watching screen when nothing is signed in                             | Shipped     | 2.2.14                                               |
| Accounts  | PIN with re-lock, avatar profile switcher                                   | Open        | 3.2.0, next                                          |
| Accounts  | tvOS system-user mapping                                                    | Open        | 3.2.0 Phase B, needs native keychain work            |
| Accounts  | LAN-change recovery, never auto-logout                                      | Shipped     | 2.0.0                                                |
| Accounts  | Tomo TV's own demo server                                                   | Shipped     | 2.2.14                                               |
| Accounts  | iCloud settings sync                                                        | Open        | second ring                                          |
| UI        | English, German, French, Spanish                                            | Shipped     | 2.2.6, language picker 2.2.9                         |
| UI        | Themes and theme editor                                                     | Shipped     | 2.2.10, background choice 2.2.11                     |
| UI        | Card size                                                                   | Shipped     | 2.2.14                                               |
| Platform  | iPhone / iPad                                                               | Shipped     | 2.0.0                                                |
| Platform  | Mac app (Mac Catalyst, Apple silicon and Intel), keyboard shortcuts         | Shipped     | 2.2.1 keys, 2.2.11 Catalyst                          |
| Platform  | Chromecast                                                                  | Non-goal    | AirPlay comes with AVPlayer                          |
| Platform  | Jellyfin SyncPlay                                                           | Shipped     | 2.2.5, video only                                    |
| Platform  | Apple SharePlay                                                             | Open        | 3.0.0                                                |
| Platform  | Apple Watch app                                                             | Non-goal    | evaluated 2026-09-01, Now Playing covers it          |
| Platform  | Android, BDMV/ISO                                                           | Non-goal    |                                                      |
| Growth    | In-app ratings prompt                                                       | Parked      | built and reviewed, in a stash, not on main          |
| Growth    | keiver.dev comparison page                                                  | Deferred    | not until the app is more solid and tested           |
| Growth    | Jellyfin.org client listing                                                 | Won't do    |                                                      |

## Open releases

Numbered by what each one is, not by when. Pull from any of them.

### 3.2.0 "Profiles" (next)

Design of record: `CLAUDE-multiuser.md` (decided 2026-08-08). Already shipped
toward it: saved sign-ins with per-account DeviceId (2.1.0) and the Who's
watching screen (2.2.14, `components/settings/WhoIsWatchingScreen.tsx`).

- Who's watching already switches between saved accounts and adds one
  through Quick Connect or a password, but only while nothing is signed in
  (`app/(tabs)/settings.tsx`). Left: a switcher while signed in, avatars from
  the server's `/Users/Public`, auto-resume of the last profile.
- Client-side 4-digit PIN (SHA-256) with cold-launch and background re-lock.
- Phase B (separate, later): tvOS system-user mapping via
  runs-as-current-user and a user-independent Keychain. Apple's API exists
  (`kSecUseUserIndependentKeychain`, SecItem.h, tvOS 16+; TVUserManager's user
  ids are deprecated in favour of it). The work is ours: expo-secure-store
  cannot set that flag, so the account store needs a native keychain path,
  and the OS relaunches the app on every user switch. A per-user Top Shelf
  bug is reported only on Apple's forums, unmeasured.

### 3.0.0 "Together"

- **SharePlay**: Apple-native watch-together remains open. Jellyfin
  SyncPlay shipped in 2.2.5 for video.
- **Multiserver View** (added 2026-08-28): Home, Search and the shelves read
  from every saved server at once instead of the active one. The account
  store already holds every server and sign-in; the session is what is
  single-server. keiver.dev/lab/tomotv names this as the planned change; keep
  the two in step. Watch the view-id collision: the same library has the same
  id on two servers, so per-server keys are required for card state.
- **Document deep links**: `tomotv:///player?videoId=<id>` already opens
  playback from any caller (Top Shelf, devicectl). Write it up
  on keiver.dev and in Help; consider an item form that opens the info panel
  instead of playing.
- **Shows**: a show already opens as Series, then Season, then Episode folder
  levels (`FOLDER_ITEM_TYPES`, `services/jellyfin/constants.ts`). The gap is a
  show screen with its seasons, episodes and Next Up together.

### 3.1.0 "The moat, visible" (shipped in 2.2.10)

- **Native scrub previews** on every lane (`IFrameIndex.swift`,
  `IFrameStore.swift`, `FrameGrabber+IFrames.swift`, `ProviderIFrames.swift`):
  an SDR `EXT-X-I-FRAMES-ONLY` variant of the source's own keyframes, copied up
  to 1080p SDR, else tone-mapped and encoded inside 1080p. Direct play gets
  AVKit's own. Live gets none.
- **One-request seeks on MPEG-TS** (`ByteTimeMap.swift`): a byte estimate on a
  map of known positions, a landing past the target seeking again; 1 to 3
  seeks on the Cosmos recording over HTTPS, where FFmpeg's timestamp seek took
  about 15 range requests (9.19 s per seek on Apple TV).

### Second ring (prioritise by demand)

Jellyseerr, Trakt scrobbling, secondary subtitles, the file's own ASS/SSA
styling (issue 113), iCloud settings sync.

## Deliberate non-goals

- Playback speed, transport UI, caption style settings: AVPlayer owns these
  and does them well. Never build a control the player already has.
- Chromecast: Apple-native strategy; AirPlay comes free with AVPlayer.
- Custom player chrome, overlay controls, private APIs: the presented AVKit
  player IS the product.
- Dolby Vision Profile 5, Android port, BDMV/ISO folder playback, Apple
  Watch app (evaluated 2026-09-01: Now Playing and Apple's Watch Remote
  already cover it).

## Standing rules that shaped the plan

- **Settings ordering:** anything new goes BEFORE the VIDEO QUALITY section.
  Its nested ScrollView traps tvOS focus, so a row placed after it is
  reachable only by scrolling the whole quality list.
- **Predicted lane without playing:** `canRemuxLocally()` is pure over
  metadata and yields the human reason. Call it inside `withRemuxPreview()`
  or a prediction overwrites the record of whatever is playing. Never
  background-play to sample streams.
- **Logger ring buffer** (`utils/logger.ts`) captures 300 lines BEFORE the
  level gate so Diagnostics has content on production builds.

## Growth

Release cadence and nothing else. No store keyword games, no client-list
submissions. The ratings prompt is built and parked, not shipped. A comparison page on keiver.dev waits
until the app is more solid and tested.
