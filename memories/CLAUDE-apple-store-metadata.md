# App Store Metadata for TomoTV

**Last Updated:** August 12, 2026

## Quick Reference

**Category:** Deployment
**Keywords:** App Store, metadata, screenshots, description, keywords, ASO, privacy policy

Complete App Store metadata including app name, description, keywords, screenshots, privacy policy, and marketing copy.

## Related Documentation

- [`CLAUDE-tvos-icons.md`](./CLAUDE-tvos-icons.md) - Icon and Top Shelf asset generation

---

## App Name (30 characters max)

**TomoTV - Jellyfin Player**
(29 characters)

---

## Subtitle/Tagline (30 characters max)

**Stream from your media server**
(30 characters)

Alternative:
**Your Jellyfin on Apple TV**
(26 characters)

---

## Promotional Text (170 characters max)

**Play your Jellyfin library on Apple TV without a server transcode. Dolby Atmos passes through untouched, surround stays surround. Just hit play.**
(145 characters)

Was, through 2.0: "Stream any video from your Jellyfin server. Automatic transcoding,
multi-audio switching, and subtitles. Just hit play. No codec headaches. Made for
Apple TV." Leading with transcoding described the app 2.0 replaced.

---

## Description (4,000 characters max)

TomoTV connects your Apple TV to your Jellyfin media server. Select a video, it plays. No configuration needed.

**FEATURES**
• H.264 and HEVC play from any container, on the device, with no server transcode
• Dolby Atmos and Dolby Digital Plus pass through untouched, on to your receiver
• Dolby TrueHD, DTS-HD Master Audio, PCM and FLAC carried losslessly, up to 7.1 channels and 24-bit
• Browse and search your entire library
• Demo mode to try the app instantly without setup
• Full playlist support with auto-continue
• Up next queue and overlay
• Multi-audio track switching
• Subtitle support
• Music and audio in a native queue player, with background playback and Lock Screen controls
• Quality presets: Original, 480p, 540p, 720p, 1080p, 4K
• Secure on-device credential storage

**SETUP**

1. Run Jellyfin on your Mac, PC, or NAS
2. Enter your server URL and credentials in Settings
3. Start watching

**REQUIREMENTS**
• Jellyfin 10.8 or later
• Network connection (HTTP or HTTPS)

**COMPATIBILITY**
Most files play exactly as they are stored. H.264 and HEVC stream-copy whatever the
container, older formats convert on the device, and your server only transcodes in
the cases nothing else covers.

**PRIVACY**
No analytics. No tracking. No ads. Your credentials stay in device Keychain. Video streams directly from your server to your Apple TV.

---

## Keywords (100 characters max, comma-separated)

**jellyfin,media,player,video,streaming,plex,server,nas,atmos,dolby,surround,hevc,movie,tv,codec**
(95 characters)

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

> DRAFT, first paragraph only. Not verified on hardware yet: the codec claim rests
> on the playback matrix passing after a prebuild. Do not submit until it has.

Far more video plays on the device instead of being converted by your server. DivX 3, Theora, DV camcorder footage, Cinepak, H.266 and the older QuickTime and screen-capture formats now play locally, as do RealAudio, ATRAC, WavPack and Musepack soundtracks. Files whose colour did not survive the old conversion, ProRes and DV footage in particular, are handled correctly now.

Dolby Digital, Dolby Digital Plus and Dolby Atmos now reach your receiver untouched. The soundtrack is passed through exactly as it is stored instead of being decoded on the device, so Atmos stays Atmos.

Surround and lossless soundtracks keep their quality. Dolby TrueHD, DTS, DTS-HD Master Audio, PCM and FLAC are carried losslessly instead of being re-encoded to 192 kbps AAC, and FLAC and Apple Lossless tracks pass through untouched. 6.1 and 7.1 keep every channel where they were previously folded down to 5.1, and 24-bit sources stay 24-bit.

Music and audio files play in a dedicated native queue player: gapless track transitions, background playback on iPhone, Now Playing and Lock Screen controls, and previous/next on the Apple TV remote.

New Up Next tab in the Apple TV player's swipe-down panel, for video and music alike: the remaining queue as selectable poster cards. Picking one jumps playback there and closes the panel.

Skip Intro and Skip Credits pills on Apple TV when your server provides segment markers, with an optional Skip Intros Automatically setting.

The between-episodes Up Next screen on Apple TV is now the system's own proposal card: the next episode's poster over the ending video, a live countdown, and Play Now / Close.

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

**Primary Category:** Photo & Video
**Secondary Category:** Entertainment

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

## Privacy Policy URL (Required)

**URL:** https://keiver.dev/lab/tomotv

**Minimum Privacy Policy Content:**

```
TomoTV Privacy Policy

Last Updated: [Date]

OVERVIEW
TomoTV is a local media player that connects to your Jellyfin server. We do not collect, store, or transmit any user data.

DATA COLLECTION
• None. TomoTV does not collect analytics, crash reports, or usage data.
• No third-party tracking or advertising SDKs are included.

CREDENTIAL STORAGE
• Server credentials (URL, API key, User ID) are stored locally on your device using the tvOS Keychain (secure, device-local storage).
• Credentials never leave your device. tvOS does not support iCloud Keychain sync.
• We never have access to your credentials.

DATA TRANSMISSION
• Video streams directly between your device and your Jellyfin server.
• No data passes through our servers (we don't have any servers).
• All network requests are made directly to your configured Jellyfin instance.

CONTACT
For questions or concerns: contact@keiver.dev
```

---

## Support URL (Required)

**URL:** https://keiver.dev/lab/tomotv

**Minimum Support Page Content:**

```
TomoTV Support

GETTING STARTED
1. Install Jellyfin (https://jellyfin.org)
2. Find your API key: Jellyfin Dashboard → API Keys → Create new key
3. Find your User ID: Jellyfin Dashboard → Users → Click your username → Copy ID from URL
4. Enter these in TomoTV Settings

COMMON ISSUES

Q: Videos won't play / black screen
A: Enable transcoding in Jellyfin Dashboard → Playback → Transcoding. Install FFmpeg if needed.

Q: Can't connect to server
A: Ensure TomoTV and Jellyfin are on same network. Check server URL includes port (e.g., http://192.168.1.100:8096)

Q: Transcoding is slow
A: Lower quality in Settings → Video Quality. Enable hardware acceleration in Jellyfin if available.

Q: Settings not saving
A: Try restarting the app. Credentials are stored in the device Keychain and persist across app launches.

CONTACT
Email: contact@keiver.dev
GitHub Issues: https://github.com/keiver/tomotv/issues
```

---

## Marketing URL (Optional)

**URL:** https://keiver.dev/lab/tomotv

**Suggested Landing Page Sections:**

1. Hero: "Stream Your Jellyfin Library on Apple TV"
2. Features: Smart transcoding, quality control, TV optimized
3. Screenshots carousel
4. Setup guide (3 steps)
5. FAQ
6. Download badge (links to App Store)

---

## Copyright

**Copyright Text:** © 2025 [Your Name or Company]. All rights reserved.

---

## App Store Screenshots Requirements

### Apple TV (Required if submitting tvOS app)

- **Size:** 1920x1080 pixels
- **Required:** 1-5 screenshots
- **Recommended:** 3-5 screenshots showing:
  1. Library grid view (with poster art)
  2. Video player with controls visible
  3. Settings screen
  4. Search screen with results
  5. Help screen (shows features)

### iPhone (if applicable)

- **6.7" Display:** 1290x2796 pixels
- **Required:** 1-10 screenshots

### iPad (if applicable)

- **12.9" Display:** 2048x2732 pixels
- **Required:** 1-10 screenshots

---

## App Preview Video (Optional but Recommended)

**Duration:** 15-30 seconds
**Content Suggestions:**

1. Show library browsing (2-3 seconds)
2. Select a video (1 second)
3. Video starts playing immediately (3-4 seconds)
4. Show remote control navigation (2-3 seconds)
5. Show search feature (2-3 seconds)
6. Show quality settings (2 seconds)
7. End with app icon and tagline: "TomoTV - Your Jellyfin on Apple TV"

**Technical Requirements:**

- Resolution: 1920x1080 (Apple TV)
- Format: M4V, MP4, or MOV
- Codec: H.264 or HEVC
- Max file size: 500 MB

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

**Version:** 2.0.0 (matches app.json)
**Build Number:** stamped into app.json by `npm run archive -- <buildNumber>`

**Version Naming Convention Going Forward:**

- 1.0.x - Bug fixes, minor tweaks
- 1.x.0 - New features (resume playback, metadata, etc.)
- x.0.0 - Major updates (UI overhaul, new platforms)

---

## Localization (Future)

**Current:** English only
**Priority Languages for v1.1+:**

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
- Disadvantage: image subtitles (PGS, DVDSUB) still force a server transcode

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
| App Name         | 30    | 29      | ✅     |
| Subtitle         | 30    | 30      | ✅     |
| Promotional Text | 170   | 144     | ✅     |
| Description      | 4,000 | 1,361   | ✅     |
| Keywords         | 100   | 99      | ✅     |
| What's New 2.1.0 | 4,000 | 1,259   | ✅     |

Counted, not estimated. The old table said the description was ~2,400; it was not.

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
"Built TomoTV to solve codec issues on Apple TV. Automatically handles transcoding so you can just hit play. Free, no ads, no tracking. Would love feedback from the community."
