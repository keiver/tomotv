# App Store Metadata for TomoTV

**Last Updated:** August 19, 2026

## Quick Reference

**Category:** Deployment
**Keywords:** App Store, metadata, screenshots, description, keywords, ASO, privacy policy

Complete App Store metadata including app name, description, keywords, screenshots, privacy policy, and marketing copy.

## Related Documentation

- [`CLAUDE-tvos-icons.md`](./CLAUDE-tvos-icons.md) - Icon and Top Shelf asset generation

---

## App Name (30 characters max)

**Tomo TV, a Jellyfin Client**
(26 characters. Read off the live listing 2026-08-19.)

---

## Subtitle/Tagline (30 characters max)

**Stream Movies, Shows & Music**
(28 characters. Read off the live listing 2026-08-19.)

---

## Promotional Text (170 characters max)

**Play your Jellyfin library on Apple TV without a server transcode. Dolby Atmos passes through untouched, surround stays surround. Just hit play.**
(144 characters)

Was, through 2.0: "Stream any video from your Jellyfin server. Automatic transcoding,
multi-audio switching, and subtitles. Just hit play. No codec headaches. Made for
Apple TV." Leading with transcoding described the app 2.0 replaced.

---

## Description (4,000 characters max)

Live since 2026-08-19, entered by Keiver (FEATURES leads, ENGINE demoted, REQUIREMENTS and the saved-sign-ins / address-change / internet CONNECT bullets cut for length and flow):

Tomo TV turns your Apple TV, iPhone and iPad into the front end for your Jellyfin server. Pick anything, it plays. One player, the system's own, for everything.

FEATURES

- Browse movies, shows, seasons, collections, music, playlists and photos
- Native search by title, genre, artist or year
- Continue Watching synced with your server, and the next episode lined up
- Top Shelf: a live Continue Watching row on the Apple TV home screen
- Up Next: the system's proposal card between episodes, and an Up Next tab in the player's swipe-down panel
- Skip Intro and Skip Credits pills on Apple TV when your server provides segment markers
- Long-press any card for an info panel: details, Resume with progress, Favorite, watched, Show in Folder
- Multi-audio switching mid-playback, no restart
- Subtitles: embedded and external text tracks, your choice remembered between episodes
- Music and audiobooks in a native queue player: gapless, background playback on iPhone, Lock Screen controls
- Photo viewer and slideshow
- Filters by favorites, genre, artist, year and played status, with shuffle
- Picture in Picture and AirPlay on iPhone and iPad
- Ambient artwork backdrops while you browse
- Demo mode: try it instantly on Jellyfin's public demo server

QUALITY

Auto is the default and it measures, not guesses: the app meters the link to each server, remembers it, and opens at what the link carries with original quality as the ceiling. Settings shows the measurement and what it carries. The fixed presets (480p to 4K) act as ceilings for the sessions your server converts.

CONNECT IN SECONDS

- Scan Network sweeps your local subnet and lists every Jellyfin server it finds, nothing to type
- Quick Connect: approve from any Jellyfin app, no passwords on the remote
- Or type just an IP; protocol and port are found automatically

THE ENGINE

Most files play exactly as stored: H.264 and HEVC from any container (MKV, MP4, AVI, WMV, TS), HDR10 and HLG included, and AV1 on the devices that decode it. Dolby Digital, Digital Plus and Atmos pass through untouched, so Atmos stays Atmos. TrueHD, DTS, DTS-HD Master Audio, PCM and FLAC are carried losslessly, 7.1 and 6.1 keep every channel, 24-bit stays 24-bit.

Older formats convert on the device itself: DivX 3, Theora, RealVideo, Cinepak, DV, VVC/H.266, ProRes and the rest of the long tail, 10-bit and interlaced sources included. Image subtitles (PGS, DVD/VobSub, DVB, XSUB) are decoded on the device and drawn over the video. Your server only transcodes the rare cases nothing else covers.

PRIVACY

No analytics. No tracking. No ads. Credentials stay in the device Keychain. Video streams directly from your server to your device.

Tomo TV is a free, open-source, independent client for Jellyfin and is not affiliated with or endorsed by the Jellyfin project. Jellyfin is a trademark of its respective owner.

---

## Keywords (100 characters max, comma-separated)

**jellyfin,media,player,video,streaming,plex,server,nas,atmos,dolby,surround,hevc,movie,tv,codec**
(94 characters)

Keywords Strategy:

- "jellyfin" (primary - core users)
- "plex" (competitor spillover)
- "media server", "nas" (adjacent searches)
- "atmos", "dolby", "surround" (the formats the app actually preserves; the audience
  searching for a Jellyfin client is the audience that knows what these mean)
- "codec", "hevc" (technical users searching for solutions)

Changed for 2.1: dropped "transcode", "local" and "remote", added "atmos", "dolby"
and "surround". "transcode" now names the fallback rather than the product.
Through 2.0 this line read:
`jellyfin,media,player,video,streaming,plex,server,nas,local,transcode,hevc,movie,tv,remote,codec`

---

## What's New (4,000 characters max)

### Version 2.1.0

> DRAFT. Submit gate: one green `npm run test:playback` on both simulators.
> Last green 2026-08-18 (71 items, 67 judged, 4 device-only skips); engine
> commits after that run (009acf2, tier fixes in b2864e7) are not yet covered.

- Far more video plays right on your device: DivX 3, Theora, DV, Cinepak, H.266 and others
- Dolby Atmos passes through untouched, and TrueHD, DTS and other surround keep full quality, every channel intact
- Music and audiobooks open in a new native player: gapless, background playback on iPhone, Lock Screen controls
- Up Next: the next episode appears over the credits with a countdown, plus a new tab to jump anywhere in the queue
- Skip Intro and Skip Credits on Apple TV when your server provides segment markers
- Picture subtitles from disc rips now play in the native player, no server re-encode
- Saved sign-ins: pick a server and continue as your user, no password retyped
- Long-press any card for an info panel: details, Resume with progress, Favorite, watched
- Your subtitle choice follows you from episode to episode

### Version 1.3.1

**4K Support**

**New Features:**
• 4K (2160p) transcoding — stream in Ultra HD quality
• Per-preset H.264 levels for optimal encoding (level 5.1 for 4K)

**Improvements:**
• Updated quality selector with 5 presets (480p through 4K)

---

### Version 1.3.0

**Quick Connect, Sign-In & Continue Watching**

**New Features:**
• Quick Connect — sign in with a code from any Jellyfin device
• Username & password sign-in
• Continue watching — resume where you left off

**Improvements:**
• Larger text for better readability on TV
• Scrolling titles on cards for long names
• Refined settings layout

---

### Version 1.2.0

**Queue Playback, Multi-Audio & Subtitles**

**New Features:**
• Play next queue — videos queue up and auto-continue so you can keep watching
• Up next overlay with progress bar shows what's coming
• Seamless multi-audio track switching during playback
• Subtitle support — external (.srt) and embedded tracks with native tvOS picker
• Native audio player improvements
• Updated app icons

**Improvements:**
• Enhanced tvOS focus and navigation reliability
• Faster native search loading
• UI and stability fixes

---

### Version 1.1.1

**Stability & Polish**

**Improvements:**
• Updated expo-tvos-search to v1.3.1 with improved native search integration
• Removed deprecated UI code for better performance
• Updated settings screen for improved reliability
• Documentation updates for developers
• Minor bug fixes and optimizations

---

### Version 1.1.0

**Demo Mode & Playlist Support**

**New Features:**
• Demo mode - Try TomoTV instantly with Jellyfin's official demo server (no setup required)
• Full playlist support - Browse and play videos from your Jellyfin playlists
• One-tap demo connection in Settings for instant testing
• Navigate into playlists just like folders with breadcrumb navigation

**Technical:**
• Auto-fetched demo credentials from Jellyfin's public demo server
• Added playlist-specific API endpoint for proper Jellyfin integration
• Improved folder type detection for UserView and Playlist types
• Enhanced error handling for demo server connectivity

---

### Version 1.0.8

**Audio Playback Support**

**New Features:**
• Audio files now visible when browsing folders in your library
• Audio files auto-play when selected, consistent with video behavior
• Dedicated audio player UI with play/pause controls

**Improvements:**
• Play/pause button auto-focuses on Apple TV remote
• TV remote select button and play/pause button toggle playback
• Improved button styling and visibility in audio player

---

### Version 1.0.7

**Stability & Polish**

**Improvements:**
• Native tvOS search now shows error alerts when connection fails
• Debug Info screen now protects your API key (shows only last 4 characters)
• Improved logging throughout the app for better debugging
• Cleaner validation flow for server settings

**Bug Fixes:**
• Fixed silent failures in tvOS native search
• Improved error recovery during search operations

---

### Version 1.0.6

**Folder Navigation & UI Improvements**

**New Features:**
• Folder navigation - browse your library by folders with breadcrumb trail
• Back button in grid for easy parent folder navigation
• Redesigned Help screen - clean landing page with QR code to documentation

**Improvements:**
• New unified dark background (#1C1C1E) across all screens
• Removed animations for smoother folder navigation
• Better focus feedback with instant border highlights
• Settings sections now have elevated card styling

**Bug Fixes:**
• Fixed jumpiness when switching folders
• Fixed animation lag on app startup

---

### Version 1.0.5

**Initial Release - Welcome to TomoTV!**

We're excited to bring you the first release of TomoTV, built from the ground up for Apple TV and Jellyfin.

**What's Included:**
• Automatic codec detection and transcoding
• 4 quality presets (480p, 540p, 720p, 1080p)
• Library browsing with infinite scroll
• Remote search with live results
• Autoplay playlist (continuous video playback)
• Subtitle support (external tracks embedded automatically)
• Secure on-device credential storage
• Comprehensive help section with troubleshooting
• Native Apple TV remote support

**Known Limitations (Coming Soon):**
• Resume playback - currently starts from beginning
• Watch history tracking
• Video metadata display (year, rating, plot)
• Continue watching section

We built TomoTV to solve one major problem: codec compatibility on Apple TV. If you've ever gotten a black screen or "cannot play" error with your Jellyfin videos, TomoTV handles it automatically.

**Feedback Welcome:**
This is our first release, and we'd love to hear from you. Visit our support page to share suggestions or report issues.

Thank you for supporting independent development!

---

## App Store Categories

**Category (live listing 2026-08-19):** Entertainment
(The public listing shows one category; the old note here claimed Photo & Video primary, which the listing does not.)

---

## Age Rating

**Rating:** 4+ (No objectionable content)

**Why 4+:**

- User-provided content (videos from user's own Jellyfin server)
- No in-app purchases or ads
- No data collection
- No social features or user-generated content beyond their own library

**Content Warnings:** None required
(App displays content from user's personal media server - similar to VLC or other media players)

---

## Privacy Policy, Support and Marketing URLs

All three ASC fields point at **https://keiver.dev/lab/tomotv**. The live page is
the content of record: its Privacy accordion covers no-analytics/Keychain/direct
streaming, Support covers contact + troubleshooting, and the body is the
marketing content. Keep the page's accordions in step with the app; source lives
at `keiver.dev/pages/lab/tomotv.tsx`.

---

## Copyright

**Seller line on the live listing (2026-08-19):** © Cubita Studio LLC
The repo's code license is separate: MIT, © 2025 Keiver Hernandez (LICENSE).

---

## App Store Screenshots Requirements

### Apple TV (Required if submitting tvOS app)

- **Size:** 1920x1080 pixels
- **Required:** 1-5 screenshots
- **Recommended:** 3-5 screenshots showing:
  1. Library grid view (with poster art)
  2. Video player with controls visible
  3. Settings screen (measured-link quality heading)
  4. Search screen with results
  5. Long-press info panel or Filters
     Current set lives in `applestore/`.

### iPhone (if applicable)

- **6.9" slot (hidden behind Media Manager):** 1320x2868 pixels, mask off via ScreenShotUseMask
- **Required:** 1-10 screenshots

### iPad (if applicable)

- **12.9" Display:** 2048x2732 pixels
- **Required:** 1-10 screenshots

---

## App Preview Video (Optional, none shipped yet)

15-30 seconds: browse, press play, playback opens instantly, end on the icon and
the live name "Tomo TV, a Jellyfin Client". 1920x1080 for Apple TV, H.264 or
HEVC, M4V/MP4/MOV, max 500 MB.

---

## App Store Review Notes (For Apple Reviewers)

Final text, sent 2026-08-09 as the Resolution Center reply to the iOS 2.0.0 Guideline 2.1
information request (numbered to match Apple's seven questions), with the physical-device
recording attached. Also lives in App Review Information → Notes; adding a platform counts as a
new app submission, so that field is required for one.

```
1. SCREEN RECORDING
Attached, captured on a physical iPhone 17 Pro running iOS 27.0. It begins with launching the
app and shows: the iOS Local Network permission prompt with its purpose string, signing out,
automatic server discovery via local subnet scan, the connect screen with its one-tap demo
server row, username and password sign-in, library browsing with the Continue Watching row,
video playback in the native system player (close, AirPlay, and Picture in Picture controls),
library filters, the Help feature guide, and landscape support. The app has no account
registration and therefore no account deletion: it signs in to accounts that already exist on
the user's own server. No purchases or subscriptions, no user-generated content or social
features, no other permission prompts.

2. TESTED ON
iPhone 17 Pro, iOS 27.0 (physical device, via TestFlight). Apple TV 4K (2nd generation),
tvOS 26.6 (physical device). An automated playback regression suite also runs on the iOS and
tvOS Simulators.

3. PURPOSE AND TARGET AUDIENCE
Tomo TV is a client for Jellyfin, the open-source self-hosted media server. Its audience is
people who already run a Jellyfin server on their own hardware and store their own media on it.
It solves codec compatibility: Apple devices reject many container/codec combinations, and the
usual workaround is slow, lossy server-side transcoding. Tomo TV repackages the original file
into HLS on the device, so video plays at original quality with no server load, falling back to
server transcoding only when the source requires it. The app ships no content of its own.

4. SETUP AND ACCESS
No login credentials are needed to review the app. On the connect screen (Settings tab), tap
the row labeled https://demo.jellyfin.org/stable and the app signs in automatically to the
Jellyfin project's public demo server. It works over the public internet and needs no
permissions. Please note this demo
server is reset regularly and can be offline intermittently. If the connection fails at first,
wait a couple of hours for it to come back up and try again, or connect to any other Jellyfin
server if one is available (username and password or Jellyfin Quick Connect).

5. EXTERNAL SERVICES
Two, and no others: (1) the user's own Jellyfin server, at whatever address they enter; all
library, search, playback, progress, and subtitle requests go directly there. (2)
demo.jellyfin.org, only in demo mode. No analytics, crash reporting, advertising or tracking
SDKs, payment processors, AI services, or third-party metadata providers, other than Apple's
own built-in App Store analytics and crash reporting. Credentials are
stored only in the device Keychain. Media processing (remuxing and transcoding) happens on the
device using bundled open-source libraries (FFmpeg).

6. REGIONAL DIFFERENCES
None. The app functions identically in all regions. No geo-gating, no region-specific features
or content.

7. REGULATED INDUSTRY / PROTECTED THIRD-PARTY MATERIAL
Not applicable. Tomo TV ships and hosts no media content. It is an independent client for the
open-source Jellyfin media server, not affiliated with the Jellyfin project; the name describes
compatibility. All media comes from the user's own self-hosted server, the same model as VLC or
the official Jellyfin client. The demo server's library is public domain and Creative Commons
material.
```

Demo mode lives in `services/jellyfin/demo.ts`; entry points are the demo `ServerRow` in
`components/settings/NotConnectedSection.tsx` and "Try Demo Server" in `app/(tabs)/search.tsx`.

---

## Build Number & Version Notes

**Version:** 2.1.0 (matches app.json; iOS build number 12 pending upload)
**Build Number:** stamped into app.json by `npm run archive -- <buildNumber>`

**Version Naming Convention Going Forward:**

- 1.0.x - Bug fixes, minor tweaks
- 1.x.0 - New features (resume playback, metadata, etc.)
- x.0.0 - Major updates (UI overhaul, new platforms)

---

## Localization (Future)

**Current:** English only
**Priority languages for a future release:**

1. Spanish (es)
2. French (fr)
3. German (de)
4. Japanese (ja)
5. Portuguese (pt-BR)

---

## App Store Optimization (ASO) Strategy

**Primary Goal:** Reach Jellyfin users searching for Apple TV clients

**Target Search Terms:**

1. "jellyfin apple tv" (exact match - high intent)
2. "jellyfin player" (broad - competitor to official app)
3. "media server apple tv" (adjacent - Plex users)
4. "video player apple tv" (broad - general market)
5. "dolby atmos apple tv" (specific - the users who notice when it is missing)

**Competitive Positioning:**

- Advantage: an on-device engine that plays H.264/HEVC from any container without a
  server transcode, Dolby passthrough with Atmos intact, and lossless carriage of
  TrueHD/DTS-HD MA/PCM/FLAC up to 7.1 and 24-bit
- Parity, not advantage: Apple TV cannot bitstream TrueHD or DTS in ANY app, so
  never imply otherwise; Infuse has the same ceiling
- Advantage (2.1): image subtitles (PGS, DVD/VobSub, DVB, XSUB) decode on the device and draw over the native player, so those files keep stream copy instead of forcing a server transcode

The old line here read "Disadvantage: Missing resume playback, metadata", which was
stale by years: resume, Continue Watching, Top Shelf and binge queueing all ship.

**Conversion Strategy:**

- Lead with playing files untouched, not with transcoding: 2.0 made the server
  transcode the exception, so selling the transcode sells the old product
- Emphasize Apple TV optimization (native feel)
- Name the formats (Atmos, TrueHD, DTS-HD MA, 7.1, 24-bit): the audience searching
  for a Jellyfin client is the audience that knows what those mean
- Show quality presets (control over experience)

---

## Character Count Summary

| Field            | Limit | Current | Status |
| ---------------- | ----- | ------- | ------ |
| App Name         | 30    | 26      | ✅     |
| Subtitle         | 30    | 28      | ✅     |
| Promotional Text | 170   | 144     | ✅     |
| Description      | 4,000 | 2,871   | ✅     |
| Keywords         | 100   | 94      | ✅     |
| What's New 2.1.0 | 4,000 | 832     | ✅     |

Counted, not estimated (script over the file's own drafts, 2026-08-19).

---

## Per-Submission Checklist

Done once and still valid:

- [x] Landing page at `https://keiver.dev/lab/tomotv` (Privacy Policy, Support, Marketing URL)
- [x] tvOS screenshots, 1920x1080, in `applestore/`
- [x] iPhone screenshots, 1320x2868, in the 6.9" slot
- [x] Icons generated at prebuild by `tvos-assets/plugin`
- [x] Export compliance: `usesNonExemptEncryption: false` in app.json

Every submission:

- [ ] Bump build number via `npm run archive -- <n>`
- [ ] Fill App Review Information → Notes with the block above
- [ ] Physical-device screen recording if this is a platform's first submission
- [ ] Update "What's New"

---

## Post-Launch Marketing

**Reddit:**

- r/jellyfin (main community)
- r/selfhosted
- r/AppleTV
- r/cordcutters

**Forums:**

- Jellyfin Community Forum
- Jellyfin Discord

**Messaging:**
"Built Tomo TV so a Jellyfin library plays in Apple's own player without the server transcoding: MKVs, Atmos passthrough, lossless surround, picture subtitles, all on the device. Free, open source, no ads, no tracking. Would love feedback from the community."
