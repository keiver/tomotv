# TomoTV Roadmap: Competitive Research & Release Plan

> Researched 2026-08-04 from primary sources, competitive section and Dolby
> Vision re-verified 2026-08-23, re-baselined against the shipped app
> 2026-09-07 (2.2.4 on the store, release/2.2.5 in flight). This is the plan
> of record and nothing in it is fixed: reorder, drop or add as demand shows.
> Each release gets its own implementation plan and harness/device
> verification when it starts.

## Positioning sentence

**"Dolby Vision and nearly every codec, inside Apple's own player. No
subscription, AirPlay included."**

Every clause targets a competitor's weak point: Swiftfin's dual-player split,
Infuse's price and paywalled AirPlay, Plex's price shocks. Never claim "plays
everything" absolutely: Infuse plays everything too (own engine), and Moonfin's
engine reached Apple on 2026-07-31. The cell nobody else occupies is doing it
INSIDE AVPlayerViewController, with the system's own transport, Up Next cards,
chapters, info panel and AirPlay picker. Anything AVPlayer already does well
(playback speed, scrubbing, the transport bar, subtitle styling) is not a
feature we build; we ship the file into the player and let the player be the
player.

## Competitive field (Apple platforms, verified 2026-08-04)

| Client                                                        | tvOS        | Traction (App Store) | Price                            | Playback                     | Has                                                                                                                                    | Weak spot for us                                                                                         |
| ------------------------------------------------------------- | ----------- | -------------------- | -------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Infuse 8.5                                                    | ✓           | 4.7★ / 28,000        | $1.99mo / $16.99yr / $99.99 life | Own engine + UI              | DV P5/P8, Atmos passthrough, downloads, Trakt, OpenSubtitles, intro-skip, TMDB metadata; ships fast (8.5 added transcode options)      | Price; AirPlay is PAID; not the native player; Jellyfin one backend of many                              |
| VidHub 3.0                                                    | ✓           | 4.6★ / 3,100         | $1.49mo / $9.99yr / $15.99 life  | Own player                   | DV/HDR, Atmos, dual subtitles, intro-skip, downloads, SMB/WebDAV/cloud                                                                 | Generic multi-source player, shallow Jellyfin integration, closed source                                 |
| SenPlayer 6.1                                                 | ✓           | 4.7★ / 1,200         | $9.99 lifetime/platform          | Own player                   | "Native Dolby Vision", 4K/8K/120fps, BDMV/ISO, downloads, DLNA                                                                         | Player-first not Jellyfin-first, closed                                                                  |
| Swiftfin 1.5 (official)                                       | ✓           | 3.8★ / 263           | Free, OSS                        | AVKit OR VLCKit (user picks) | Native UI, Live TV, multi-user                                                                                                         | Reviews cite: no downloads, no Atmos/DTS/DV, ATV4K perf, missing subtitle controls                       |
| Streamyfin                                                    | ✓ (new)     | small                | Free, OSS                        | VLC on tvOS                  | Downloads, intro-skip, trickplay, Chromecast, Jellyseerr, TopShelf                                                                     | RN+Expo like us but chose VLC over native player                                                         |
| JellyTV                                                       | ✓           | new                  | $19.99–39.99 life                | ?                            | Seerr, downloads, Trakt/AniList, push notifications, admin tools                                                                       | Paid, closed, unproven                                                                                   |
| Moonfin                                                       | ✓ (Flutter) | 600 stars            | Free, OSS                        | AetherEngine (third party)   | On-device engine since 2.3.2 (2026-07-31), DV profile 7 to 8.1 via libdovi, Atmos, downloads, Seerr, themes, Live TV, SMB, 9 platforms | Engine is a third-party dependency, 43-decoder allowlist grown one per release, Flutter chrome not AVKit |
| Mediora / Filebar / HamHub / MrMC / JellySee                  | ✓           | tail                 | mixed                            | mixed                        | niche                                                                                                                                  | none                                                                                                     |
| Jellyflix / iPlay / Fladder / Phyn / official Jellyfin Mobile | iOS only    | tail                 | mostly free                      | mixed                        | none                                                                                                                                   | none                                                                                                     |

Sources: awesome-jellyfin CLIENTS.md; App Store pages (Infuse id1136220934,
Swiftfin id1604098728, VidHub id1659622164, SenPlayer id6443975850, JellyTV
id6752357290, Mediora id6757345487); streamyfin/streamyfin issue #137 (tvOS
release); Moonfin-Client/Moonfin-Core; jellywatch.app 2026 client guide.

## Demand signal: Swiftfin open issues by community reactions (2026-08-04)

Where each ask stands in Tomo TV as of 2026-09-07.

| Reactions | Ask                                          | Tomo TV                                                                        |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| 143       | Local downloads / offline                    | Shipped 2.2.0 (iPhone/iPad; Apple TV has no persistent storage)                |
| 42        | Chromecast (iOS)                             | Non-goal; AirPlay comes with AVPlayer                                          |
| 41        | macOS build                                  | Runs as Designed for iPad with Mac keyboard support (2.2.1); Catalyst deferred |
| 28        | SharePlay                                    | Open, second ring                                                              |
| 26        | tvOS deep links                              | `tomotv://` scheme exists (Top Shelf, dev session); no public per-item link    |
| 23        | SyncPlay                                     | Open, second ring                                                              |
| 15        | Map Apple TV users to Jellyfin users         | Open, profiles Phase B (blocked on Apple, see 3.2)                             |
| 9         | Secondary subtitles                          | Open, second ring                                                              |
| 9         | Skip button for media segments (intro/outro) | Shipped 2.1.0                                                                  |
| 8         | Random order play                            | Shipped: shuffle in library filters (2.1) and download folders (2.2.x)         |

## Field lessons

1. 2026 freemium table stakes: **downloads + intro-skip + Seerr/Jellyseerr**
   (JellyTV sells Seerr, Streamyfin ships it). We have two of three.
2. **Dolby Vision sells**: SenPlayer's whole pitch, Infuse's crown, top
   Swiftfin review complaint. Profiles 8.1, 8.4 and 7-to-8.1 conversion are
   device-verified (`hdrMode = Dolby` in Console.app). Profile 5 stays out.
3. **Store traction ≠ mindshare**: Swiftfin owns Reddit with 263 ratings;
   VidHub ships monthly with 3,100; Infuse has 28,000. Release cadence,
   in-app ratings prompts, and ASO are a real competitive lane. 2.2.0 to
   2.2.4 shipped in about two weeks; keep that.
4. **The cell that is actually ours**: free, open source, Jellyfin-first,
   on-device engine, inside Apple's own player. Moonfin matches every clause
   but the last and cannot reach it without leaving Flutter: AetherEngine
   hands its host a CALayer and says "You ship the UI".
5. Everyone is converging on this position: Infuse added transcode options,
   Swiftfin maintains two players, Moonfin adopted an engine. Cadence is the
   lane, not novelty.
6. **Quote behaviour, not registration.** The defensible line is "no
   `--disable-decoders`, 59 of 110 allowlist prefixes proven through the real
   pipeline, zero failures", never "497 decoders". `npm run test:engine` is
   what turns registered into reachable.
7. **The plan was a floor, not the route.** Most of what shipped between
   2.1.0 and 2.2.4 came from issues and sessions (music, photos, diagnostics,
   artwork), not from the numbered releases below. The numbered releases are
   candidates, and a user issue outranks them.

## Status board (2026-09-07, 2.2.4 on the store)

Every item the plan, the demand signal or a shipped release has named.
Version is the one whose changelog carries it.

| Area     | Item                                                             | Status   | Where                                                |
| -------- | ---------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| Engine   | H.264/HEVC stream copy from any container                        | Shipped  | 2.0.0                                                |
| Engine   | VideoToolbox transcode for legacy codecs                         | Shipped  | 2.0.0, widened 2.1.0 (DivX 3, Theora, DV, VVC, Real) |
| Engine   | Any resolution on device, realtime gate, per-file memory         | Shipped  | 2.2.2                                                |
| Engine   | 10-bit HEVC probe, 8-bit fallback                                | Shipped  | 2.2.3                                                |
| Engine   | AV1 software decode lane                                         | Shipped  | 2.2.3                                                |
| Engine   | HDR10 / HLG passthrough                                          | Shipped  | 2.0.0                                                |
| Engine   | Dolby Vision 8.1 / 8.4 stream copy                               | Shipped  | 2.2.0, device-verified                               |
| Engine   | Dolby Vision profile 7 to 8.1 on the fly                         | Shipped  | 2.2.0, device-verified                               |
| Engine   | Dolby Vision profile 5                                           | Non-goal |                                                      |
| Engine   | Multi-audio switching, seamless                                  | Shipped  | 2.0.0, seamless 2.1.0                                |
| Engine   | DD / DD+ / Atmos passthrough                                     | Shipped  | 2.1.0, device-verified                               |
| Engine   | TrueHD, DTS-HD MA, PCM, FLAC lossless, 7.1, 24-bit               | Shipped  | 2.1.0                                                |
| Engine   | Text subtitles as HLS renditions                                 | Shipped  | 2.0.0                                                |
| Engine   | Image subtitles (PGS, VobSub, DVB, XSUB) on device               | Shipped  | 2.1.0                                                |
| Engine   | Subtitle choice remembered between items                         | Shipped  | 2.1.0                                                |
| Engine   | Secondary subtitles                                              | Open     | second ring                                          |
| Engine   | Adaptive Auto quality, link measured per server                  | Shipped  | 2.1.0                                                |
| Engine   | Server rung proved before it is offered                          | Shipped  | 2.2.3                                                |
| Engine   | Stall recovery, seek timestamp repair                            | Shipped  | 2.1.0, 2.2.3                                         |
| Engine   | Native scrub previews (I-frame playlist)                         | Open     | 3.1.0, nothing built                                 |
| Engine   | Host-side engine tests, codec coverage measured                  | Shipped  | `npm run test:engine`, 59/110 proven                 |
| Player   | Skip Intro / Skip Credits, auto-skip toggle                      | Shipped  | 2.1.0                                                |
| Player   | Native chapters in the tvOS info panel                           | Shipped  | 2.2.1, device-made images 2.2.2                      |
| Player   | Native Up Next card and Up Next tab                              | Shipped  | 2.1.0                                                |
| Player   | Picture in Picture (iPhone/iPad)                                 | Shipped  | 2.0.0                                                |
| Player   | Music queue: gapless, background, Now Playing, mini player       | Shipped  | 2.1.0, mini player 2.2.0                             |
| Player   | Photo viewer: slideshow, gestures, share                         | Shipped  | 2.2.0, 2.2.1                                         |
| Player   | Playback speed                                                   | Non-goal | AVPlayer owns it                                     |
| Player   | Custom controls / overlay chrome                                 | Non-goal | presented AVKit is the product                       |
| Library  | Downloads: originals, offline play, folders, storage gauge       | Shipped  | 2.2.0, folders 2.2.2 (iPhone/iPad)                   |
| Library  | Offline progress queued and synced                               | Shipped  | 2.2.0                                                |
| Library  | Item detail: long-press info panel with overview and cast        | Shipped  | 2.1.0                                                |
| Library  | Playback Info / Diagnostics, Send to iPhone                      | Shipped  | 2.2.1, 2.2.2, 2.2.3                                  |
| Library  | Continue Watching next-up, binge queue                           | Shipped  | 2.0.0                                                |
| Library  | Top Shelf (tvOS)                                                 | Shipped  | 2.0.0                                                |
| Library  | Filters: favorites, genre, artist, year, per-library scope       | Shipped  | 1.7.0                                                |
| Library  | Random order play (shuffle)                                      | Shipped  | 1.7.0 filters, 2.2.2 download folders                |
| Library  | Keyframe artwork, folder collages, season poster fallback        | Shipped  | 2.2.2                                                |
| Library  | Shows tree: seasons and episodes surface                         | Partial  | Next Up derived, no dedicated tree                   |
| Library  | Jellyseerr discover and request                                  | Open     | 3.0.0                                                |
| Library  | Multiserver View                                                 | Open     | 3.0.0                                                |
| Library  | Public per-item deep links                                       | Partial  | `tomotv://` routes Top Shelf only                    |
| Library  | Live TV                                                          | Open     | second ring                                          |
| Library  | Trakt scrobbling                                                 | Open     | second ring                                          |
| Library  | OpenSubtitles download                                           | Open     | second ring, built once and removed                  |
| Accounts | Saved sign-ins, per-account DeviceId, Continue as, Switch Server | Shipped  | 2.1.0                                                |
| Accounts | In-app profiles picker, PIN                                      | Open     | 3.2.0                                                |
| Accounts | tvOS system-user mapping                                         | Open     | 3.2.0 Phase B, blocked on Apple                      |
| Accounts | LAN-change recovery, never auto-logout                           | Shipped  | 2.0.0                                                |
| Accounts | iCloud settings sync                                             | Open     | second ring                                          |
| Platform | iPhone / iPad                                                    | Shipped  | 2.0.0                                                |
| Platform | Mac as Designed for iPad, keyboard shortcuts                     | Shipped  | 2.2.1                                                |
| Platform | Mac Catalyst build                                               | Open     | second ring                                          |
| Platform | Chromecast                                                       | Non-goal | AirPlay comes with AVPlayer                          |
| Platform | SharePlay / SyncPlay                                             | Open     | second ring, largest open ask                        |
| Platform | Apple Watch app                                                  | Non-goal | evaluated 2026-09-01, Now Playing covers it          |
| Platform | Android, BDMV/ISO                                                | Non-goal |                                                      |
| Growth   | In-app ratings prompt                                            | Open     | 3.0.0                                                |
| Growth   | keiver.dev comparison page                                       | Open     | marketing lane                                       |
| Growth   | Jellyfin.org client listing                                      | Open     | eligible 2026-11-08                                  |

**Totals:** 60 rows. Shipped 37, Partial 2, Open 15, Non-goal 6.

## Open releases

Numbered by what each one is, not by when. Pull from any of them.

### 3.0.0 "Discover"

- **Jellyseerr**: discover and request from the couch. The third
  freemium table stake and the one we lack. Streamyfin ships it, JellyTV
  sells it.
- **Multiserver View** (added 2026-08-28): Home, Search and the shelves read
  from every saved server at once instead of the active one. The account
  store already holds every server and sign-in; the session is what is
  single-server. keiver.dev/lab/tomotv names this as the planned change; keep
  the two in step. Watch the view-id collision: the same library has the same
  id on two servers, so per-server keys are required for card state.
- **Public deep links**: `tomotv://` already routes Top Shelf and the dev
  session. Give it a per-item form users can share and Shortcuts can call.
  26 reactions on Swiftfin and nearly free.
- **Shows**: seasons and episodes as a browsable tree with Next Up. The
  data is fetched already (`services/nextUp.ts`); the surface is the gap.
- **In-app ratings prompt** at a delight moment (after N hours played).
  Marketing lane item that has slipped three releases.

### 3.1.0 "The moat, visible"

- **Native scrub previews**: emit an `EXT-X-I-FRAMES-ONLY` variant over our
  own segments (the engine knows every keyframe's byte range) so tvOS draws
  its own scrubbing thumbnails with zero server work. Impossible for
  server-HLS clients and for own-engine clients alike. Nothing of it exists
  in native/ or services/ yet.

### 3.2.0 "Profiles"

Design of record: `CLAUDE-multiuser.md` (decided 2026-08-08). Saved sign-ins
with per-account DeviceId already cover the storage half.

- In-app profiles as a first-class picker with avatars from `/Users/Public`,
  auto-resume last profile, add-user through the existing Quick Connect and
  password flows.
- Client-side 4-digit PIN (SHA-256) with cold-launch and background re-lock.
- Phase B (separate, later): tvOS system-user mapping via
  runs-as-current-user and a user-independent Keychain. Blocked by Apple's
  per-user Top Shelf bug (forum 668938), relaunch-on-switch semantics, and
  expo-secure-store lacking `kSecUseUserIndependentKeychain`. Only Infuse
  ships this, buggy.

### Second ring (prioritise by demand)

SharePlay/SyncPlay (28 + 23 reactions, the largest open ask), Trakt
scrobbling, OpenSubtitles download, Live TV, secondary subtitles, iCloud
settings sync, Catalyst build.

## Deliberate non-goals

- Playback speed, transport UI, subtitle styling: AVPlayer owns these and
  does them well. Never build a control the player already has.
- Chromecast: Apple-native strategy; AirPlay comes free with AVPlayer and is
  a PAID feature in Infuse (marketing line, not a gap).
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

## Parallel marketing lane

- Release cadence (VidHub ships monthly; it shows in ratings volume).
- In-app ratings prompt (moved into 3.0.0 above so it stops slipping).
- ASO around "no transcoding / MKV / Dolby Vision / no subscription /
  Jellyfin".
- keiver.dev comparison page vs Infuse/Swiftfin/Moonfin. Jellyfin.org
  client listing eligible 2026-11-08 (one-year rule, jellyfin.org PR 1833).
