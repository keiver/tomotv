# TomoTV Roadmap: Competitive Research & Release Plan (2.1.0 → 3.1.0)

> Researched 2026-08-04 from primary sources. This file is the plan of record
> for post-2.0.0 releases; session plan files get overwritten, this does not.
> Each release gets its own implementation plan + harness/device verification
> when it starts. Entry criteria for 2.1.0: 2.0.0 shipped, device matrix
> verified.

## Positioning sentence

**"Plays nearly everything in Apple's native player — no server transcoding,
no subscription, AirPlay included."**

Every clause targets a competitor's weak point: Swiftfin's dual-player split,
Infuse's price and paywalled AirPlay, Plex's price shocks. Never claim
"plays everything" absolutely: Infuse plays everything too (own engine);
our unique cell is doing it INSIDE the native player.

## Competitive field (Apple platforms, verified 2026-08-04)

| Client                                                        | tvOS        | Traction (App Store) | Price                            | Playback                     | Has                                                                                                                               | Weak spot for us                                                                   |
| ------------------------------------------------------------- | ----------- | -------------------- | -------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Infuse 8.5                                                    | ✓           | 4.7★ / 28,000        | $1.99mo / $16.99yr / $99.99 life | Own engine + UI              | DV P5/P8, Atmos passthrough, downloads, Trakt, OpenSubtitles, intro-skip, TMDB metadata; ships fast (8.5 added transcode options) | Price; AirPlay is PAID; not the native player; Jellyfin one backend of many        |
| VidHub 3.0                                                    | ✓           | 4.6★ / 3,100         | $1.49mo / $9.99yr / $15.99 life  | Own player                   | DV/HDR, Atmos, dual subtitles, intro-skip, downloads, SMB/WebDAV/cloud                                                            | Generic multi-source player, shallow Jellyfin integration, closed source           |
| SenPlayer 6.1                                                 | ✓           | 4.7★ / 1,200         | $9.99 lifetime/platform          | Own player                   | "Native Dolby Vision", 4K/8K/120fps, BDMV/ISO, downloads, DLNA                                                                    | Player-first not Jellyfin-first, closed                                            |
| Swiftfin 1.5 (official)                                       | ✓           | 3.8★ / 263           | Free, OSS                        | AVKit OR VLCKit (user picks) | Native UI, Live TV, multi-user                                                                                                    | Reviews cite: no downloads, no Atmos/DTS/DV, ATV4K perf, missing subtitle controls |
| Streamyfin                                                    | ✓ (new)     | small                | Free, OSS                        | VLC on tvOS                  | Downloads, intro-skip, trickplay, Chromecast, Jellyseerr, TopShelf                                                                | RN+Expo like us but chose VLC over native player                                   |
| JellyTV                                                       | ✓           | new                  | $19.99–39.99 life                | ?                            | Seerr, downloads, Trakt/AniList, push notifications, admin tools                                                                  | Paid, closed, unproven                                                             |
| Moonfin                                                       | ✓ (Flutter) | new                  | Free, OSS                        | Flutter                      | Seerr-first discovery/requests, unified multi-server, Emby                                                                        | Young; Flutter-on-tvOS UX                                                          |
| Mediora / Filebar / HamHub / MrMC / JellySee                  | ✓           | tail                 | mixed                            | mixed                        | niche                                                                                                                             | —                                                                                  |
| Jellyflix / iPlay / Fladder / Phyn / official Jellyfin Mobile | iOS only    | tail                 | mostly free                      | mixed                        | —                                                                                                                                 | —                                                                                  |

Sources: awesome-jellyfin CLIENTS.md; App Store pages (Infuse id1136220934,
Swiftfin id1604098728, VidHub id1659622164, SenPlayer id6443975850, JellyTV
id6752357290, Mediora id6757345487); streamyfin/streamyfin issue #137 (tvOS
release); Moonfin-Client/Moonfin-Core; jellywatch.app 2026 client guide.

## Demand signal: Swiftfin open issues by community reactions (2026-08-04)

| Reactions | Ask                                          |
| --------- | -------------------------------------------- |
| 143       | Local downloads / offline                    |
| 42        | Chromecast (iOS)                             |
| 41        | macOS build                                  |
| 28        | SharePlay                                    |
| 26        | tvOS deep links                              |
| 23        | SyncPlay                                     |
| 15        | Map Apple TV users to Jellyfin users         |
| 9         | Secondary subtitles                          |
| 9         | Skip button for media segments (intro/outro) |
| 8         | Random order play                            |
| 5         | Playback speed options                       |

## Field lessons

1. 2026 freemium table stakes: **downloads + intro-skip + Seerr/Jellyseerr**
   (Seerr is Moonfin's headline, JellyTV sells it, Streamyfin ships it).
2. **Dolby Vision sells**: SenPlayer's whole pitch, Infuse's crown, top
   Swiftfin review complaint. DV Profile 8 deserves an R&D spike (AVPlayer
   supports DV in HLS via dvh1 CODECS — and we own the master playlist).
   Profile 5 stays out of scope.
3. **Store traction ≠ mindshare**: Swiftfin owns Reddit with 263 ratings;
   VidHub ships monthly with 3,100; Infuse has 28,000. Release cadence,
   in-app ratings prompts, and ASO are a real competitive lane.
4. **Our empty quadrant** (verified against 20+ clients): free, open-source,
   Jellyfin-first, NATIVE player, on-device engine. Every competitor lacks at
   least two. Streamyfin choosing VLC on tvOS confirms the moat.
5. Both leaders are converging toward our position (Infuse adding transcode
   options; Swiftfin maintaining two players). Plant the flag early.

## Release plan

### 2.1.0 — "Native flexes"

Small items, each release-noteworthy, two impossible or paid elsewhere.

- **Skip Intro/Credits**: Jellyfin Media Segments API (10.10+) → overlay
  button + auto-skip setting. Same overlay pattern as
  `components/up-next-overlay.tsx`.
  _Shipped 2026-08-10_ with the native Up Next work: Media Segments client
  (`services/jellyfin/mediaSegments.ts`, Intro+Outro), tvOS Skip Intro /
  Skip Credits pills (native `contextualActions` via the react-native-video
  patch; queue-mode outro belongs to the Up Next proposal instead), and the
  Settings → Playback "Skip Intros Automatically" toggle (auto-skip on both
  platforms via `useVideoPlayback`).
- **Native chapter markers**: Jellyfin chapter data → AVPlayer
  `navigationMarkerGroups`; chapters appear in the native tvOS transport UI
  (VLC/mpv clients must fake this).
- **Playback speed**: AVPlayer rate + control.
- **Atmos/5.1 passthrough spike**: _Shipped and verified 2026-08-12._ The
  header-ordering problem was solved with `delay_moov` scoped to Dolby
  renditions — the old belief that it produced a bare mdat was wrong:
  write_header emits nothing, the first cut is ftyp+moov, the second is the
  segment. AC-3 and E-AC-3 now copy byte-for-byte with JOC intact, and TrueHD,
  DTS-HD MA, PCM and FLAC carry losslessly at source layout and depth instead
  of 192 kbps AAC capped at 6 channels.
  Verified end to end on an Apple TV without a receiver: the Control Center
  AirPods panel reads **DOLBY ATMOS** for T88 (genuine JOC from Apple's HLS
  example) and **MULTICHANNEL** for T83 (plain DD+), so the badge tracks the
  real source format rather than a capability. The engine also reports its own
  per-stream decisions over `onEnginePlan`, pinned in every playback baseline.
- **Image subtitles in the native player**: _Shipped and verified 2026-08-13._
  PGS, DVD/VobSub, DVB and XSUB are decoded on device to timed bitmaps the app
  draws over AVPlayer. AVPlayer has no bitmap subtitle renderer, so before this
  the only way to show them was burn-in, which meant handing the server the
  whole file to re-encode. A Blu-ray remux whose only subtitles are pictures now
  plays with its video stream-copied and its lossless audio intact.
  **This was the last category that sent a file to the server for a reason other
  than a codec the engine cannot take.** What remains is 4K/8K and 10-bit exotic
  codecs, interlaced sources, and DivX 3/Theora. It is also the sharpest form of
  the positioning sentence: showing PGS while staying inside Apple's player is
  precisely the cell an own-engine client cannot occupy.
  Track identity is the rendition's ordinal in AVFoundation's legible group, not
  its label — Jellyfin gives all 13 of a disc's untagged PGS tracks the same
  `DisplayTitle`, and the resolver refuses rather than guessing when the player's
  view of the group disagrees with what the engine published. Cues clear the
  transport bar using `AVPlayerViewController.unobscuredContentGuide` rather
  than a guessed fraction of screen height.
  Verified on device: 13 distinct picker rows on T85 with the chosen track's
  bitmaps drawn, forced text subtitles restored on T05, the HDR badge on T10
  (which also proves the new `CODECS` attribute is accepted), and 55/55 in the
  playback suite.

### 2.2.0 — "Downloads"

The #1 community ask (143 reactions) and an Infuse/VidHub/Streamyfin
table-stake.

- Background URLSession download of ORIGINAL files (byte-range resumable).
- Offline playback = existing engine with a file:// input (harness-proven:
  the pipeline runs from local paths). No second conversion pipeline;
  original quality, multi-audio, and subtitles survive offline for free.
- Downloads surface + storage management (sizes, delete, auto-cleanup).

### 3.0.0 — "The library grows up" (major UX version)

- Item detail pages: backdrop, overview, cast, genres, runtime — all fields
  already in the Jellyfin item payload we fetch.
- **Playback Info lives here, not in Settings.** Scope reviewed 2026-08-12: a
  working version was built during the 2.1 audio work and deliberately deferred,
  because a stream-info screen and an item detail page are one concept and
  building them separately means building the same page twice. The code is
  parked on `feat/playback-info`. Design as settled:
  - Jellyfin `MediaStreams` is the base layer, so every track shows on every
    item — video, all audio, **all subtitles** — whether or not anything played.
    The engine's plan covers only what it carries and only when it ran, so
    driving the screen off the plan alone left subtitles invisible everywhere
    and direct/transcode items completely blank.
  - The engine's copy-vs-re-encode verdict overlays that, matched by stream
    index. It is the engine's own report (`onEnginePlan`), not an inference.
  - Predicted path without playing anything: `canRemuxLocally()` is pure over
    metadata and already yields the human reason (`"resolution over transcode
gate"`, `"interlaced source"`). The burn-in decline this used to cite is
    gone: image subtitles reach the engine now. Call it inside
    `withRemuxPreview()` or a prediction
    overwrites the record belonging to whatever is actually playing.
  - Do NOT background-play to sample streams. It costs a real session per item
    browsed to learn what metadata plus that one function already say. If exact
    per-track truth is wanted before playback, add a native `probePlan()` dry
    run: `RemuxSession` already opens the input and builds transcoders before
    producing anything, so the prefix can return the plan with no pipeline
    thread and no segments.
  - `utils/logger.ts` keeps a 300-line ring buffer captured BEFORE the level
    gate. Production sets `minLevel` to `warn` and the engine plan is `info`, so
    retaining after the gate would leave the screen empty on the only build
    where nobody has a Metro console attached.
- **Settings ordering rule:** anything new goes BEFORE the VIDEO QUALITY
  section. Its nested ScrollView traps tvOS focus — focus only leaves a scrolled
  ScrollView downward once it is already at the end (see the `pinListToBottom`
  comment at `app/(tabs)/settings.tsx:250`) — so a row placed after it is
  reachable only by scrolling the whole quality list.
- Shows experience: seasons, episodes, Next Up API.
- Random order play (shuffle infrastructure exists in filters).
- Jellyseerr integration: discover + request from the couch.

### 3.1.0 — "The moat, visible"

- **Native scrub previews**: emit an EXT-X-I-FRAMES-ONLY variant over our
  own segments (the engine knows every keyframe's byte range) → native tvOS
  scrubbing thumbnails, zero server work. Impossible for server-HLS clients.
- **Dolby Vision Profile 8 R&D spike**: dvh1 CODECS declaration in our
  master playlist; measure what AVPlayer accepts from remuxed DV8 MKVs.

### 3.2.0 — "Profiles" (multi-user)

Design of record: `CLAUDE-multiuser.md` (researched + decided 2026-08-08).

- In-app profiles, full server×user matrix (Streamyfin storage pattern,
  Swiftfin UX pattern). Existing SecureStore keys stay as the active-session
  slot; account store layers above (`services/jellyfin/accounts.ts`).
- Per-profile DeviceId (Jellyfin revokes tokens per device on user change).
- Client-side 4-digit PIN (SHA-256) with cold-launch + background re-lock.
- Auto-resume last profile; avatar picker from `/Users/Public`; add-user
  reuses the existing Quick Connect/password flow.
- Phase B (separate, later): tvOS system-user mapping via runs-as-current-user
  - user-independent Keychain. Blocked today by Apple's per-user Top Shelf bug
    (forum 668938), relaunch-on-switch semantics, and expo-secure-store lacking
    `kSecUseUserIndependentKeychain`. Only Infuse ships this, buggy.

### Second ring (post-3.2, prioritize by demand)

Trakt scrobbling, OpenSubtitles download, SharePlay/SyncPlay, Live TV,
secondary subtitles, iCloud settings sync, multiuser Phase B (tvOS system-user
mapping, see 3.2.0 above).

### Deliberate non-goals

- Chromecast: Apple-native strategy; AirPlay comes free with AVPlayer (and
  is a PAID feature in Infuse — marketing line, not a gap).
- Dolby Vision Profile 5, Android/macOS ports, BDMV/ISO folder playback.

### Parallel marketing lane

- Release cadence (VidHub ships monthly; it shows in ratings volume).
- In-app ratings prompt at a delight moment (e.g., after N hours played).
- ASO around "no transcoding / MKV / no subscription / Jellyfin".
- keiver.dev comparison page vs Infuse/Swiftfin once 2.1 ships.
