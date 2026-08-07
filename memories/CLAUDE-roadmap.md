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
- **Native chapter markers**: Jellyfin chapter data → AVPlayer
  `navigationMarkerGroups`; chapters appear in the native tvOS transport UI
  (VLC/mpv clients must fake this).
- **Playback speed**: AVPlayer rate + control.
- **Atmos/5.1 passthrough spike**: AVPlayer natively plays AC-3/E-AC-3 in
  fMP4 HLS; the engine currently transcodes both to AAC (destroying Atmos)
  to dodge the mp4 muxer's dac3 header-ordering problem. Solve the ordering
  (extradata priming or delayed header on the audio track), pass ac3/eac3
  through, verify via an Atmos receiver. Matches Infuse's headline audio
  feature inside the native player.

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
- Shows experience: seasons, episodes, Next Up API.
- Random order play (shuffle infrastructure exists in filters).
- Jellyseerr integration: discover + request from the couch.

### 3.1.0 — "The moat, visible"

- **Native scrub previews**: emit an EXT-X-I-FRAMES-ONLY variant over our
  own segments (the engine knows every keyframe's byte range) → native tvOS
  scrubbing thumbnails, zero server work. Impossible for server-HLS clients.
- **Dolby Vision Profile 8 R&D spike**: dvh1 CODECS declaration in our
  master playlist; measure what AVPlayer accepts from remuxed DV8 MKVs.

### Second ring (post-3.1, prioritize by demand)

Trakt scrobbling, OpenSubtitles download, SharePlay/SyncPlay, Live TV, tvOS
user mapping, secondary subtitles, iCloud settings sync.

### Deliberate non-goals

- Chromecast: Apple-native strategy; AirPlay comes free with AVPlayer (and
  is a PAID feature in Infuse — marketing line, not a gap).
- Dolby Vision Profile 5, Android/macOS ports, BDMV/ISO folder playback.

### Parallel marketing lane

- Release cadence (VidHub ships monthly; it shows in ratings volume).
- In-app ratings prompt at a delight moment (e.g., after N hours played).
- ASO around "no transcoding / MKV / no subscription / Jellyfin".
- keiver.dev comparison page vs Infuse/Swiftfin once 2.1 ships.
