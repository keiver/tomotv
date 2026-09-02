# App Store Metadata for TomoTV

**Last Updated:** September 1, 2026

## Quick Reference

**Category:** Deployment
**Keywords:** App Store, metadata, screenshots, description, keywords, ASO, privacy policy

Complete App Store metadata including app name, description, keywords, screenshots, privacy policy, and marketing copy.

## Related Documentation

- [`CLAUDE-tvos-icons.md`](./CLAUDE-tvos-icons.md) - Icon and Top Shelf asset generation

---

## Paste blocks (App Store Connect)

Canonical copy, fenced so it copies clean with no leading whitespace. The
sections further down carry the reasoning, the history and the character-count
table; if they ever disagree with these blocks, **these blocks win**.

### App Name (26 / 30)

```text
Tomo TV, a Jellyfin Client
```

### Subtitle (30 / 30)

```text
Movies, Shows, Music in 4K HDR
```

### Promotional Text (138 / 170)

```text
Finds your Jellyfin server on the network, nothing to type. Stream at the right quality straight away. Plays it all in Apple's own player.
```

### Keywords (99 / 100)

```text
media,player,downloads,server,nas,atmos,dolby,surround,hevc,codec,mkv,subtitle,selfhosted,audiobook
```

### Description (3,385 / 4000)

```text
Tomo TV plays your Jellyfin library in Apple's own player. Free, open source, and almost nothing has to go through your server's transcoder.

Your Apple TV, iPhone and iPad do the work a server usually does. H.264 and HEVC play straight from the file in any container. Older and stranger formats are converted on the device itself. Your server only steps in for the rare case nothing else covers.

WHAT MAKES IT DIFFERENT

- Apple's own player, with the controls, gestures and swipe-down panel you already know. AirPlay and Picture in Picture come with it.
- Quality that adapts while the film keeps running. If your connection dips, the picture steps down and climbs back on its own, with nothing to choose and no trip back to the start.
- Sound that does not step down with it. Dolby Atmos passes through untouched, and TrueHD, DTS-HD Master Audio, PCM and FLAC are carried losslessly. When the picture adapts, the audio is not re-encoded along with it.
- Downloads on iPhone and iPad. Keep an item or a whole folder on the device and play it with no server in reach; where you got to is held and syncs back the next time there is one.
- Disc subtitles handled on the device. PGS, VobSub, DVB and XSUB are decoded to timed bitmaps and drawn over the video, so the picture stays stream-copied.
- A server that stays found. If its address changes later, the app recognises the same server by its identity and reconnects, instead of asking you to sign in again.

WHAT YOU GET

- Movies, shows, seasons, collections, music, playlists and photos
- Search across titles, genres, artists and years
- Continue Watching in sync with your server, with the next episode already lined up
- Top Shelf on Apple TV, putting Continue Watching on the home screen
- Up Next between episodes, plus a queue tab inside the player
- Skip Intro and Skip Credits when your server provides the markers
- Long press any card for cast, ratings, plot and full technical detail, plus Resume, Favorite and watched
- Several audio tracks, switchable during playback
- Your subtitle choice remembered from one episode to the next
- Music and audiobooks in a gapless queue player with Lock Screen controls
- Photo viewer and slideshow
- Filters by favorite, genre, artist, year and played state, with shuffle
- Several servers, several users on each, and switching between them without typing a password again

SET UP IN SECONDS

- Scan Network sweeps your subnet and lists every Jellyfin server it finds, nothing to type
- Quick Connect: approve from any Jellyfin app, no password on the remote
- Or type just an IP, and the protocol and port are found for you
- Demo mode: try the whole app on Jellyfin's public demo server before connecting anything

QUALITY

Auto is the default, and it measures rather than guesses. The app times the connection to each server, remembers it per network, and opens at the quality that connection carries, with your original file as the ceiling. Fixed presets from 480p to 4K are there if you would rather set the ceiling yourself.

PRIVACY

No analytics. No tracking. No ads. No account with us. Your credentials stay in the device Keychain, and video streams straight from your server to your device.

Tomo TV is a free, open-source, independent client for Jellyfin and is not affiliated with or endorsed by the Jellyfin project. Jellyfin is a trademark of its respective owner.
```

### What's New (2.2.1), iOS (1322 / 4000)

```text
- Pinch to zoom a photo, double tap to zoom to the spot you touched or back out, and share one from its info panel
- Drag left or right to change photo, with no side taps to fight the drag, and drag down to close the viewer
- The photo viewer's close and slideshow are one glass control that opens them out of itself
- Photos open the one you actually picked, from an info panel or from the New, Favorites and Search shelves
- Show in Folder arrives with the item on screen and selected instead of scrolling to it later
- Hardware keyboard on the Mac: space and Return play and pause, the arrow keys seek fifteen seconds, and a double click on a video fills the frame
- The music player's artwork is a rounded card over a wash of itself, clear of the transport bar in any window
- The mini player's skips dim at the ends of the queue, and a press on Pause no longer lands on Next
- Diagnostics, in Settings under About Tomo TV: what the engine did on the last playback, the lane it chose and why it declined a file, the streams your server described, every error, and the version. Copy it into a bug report. Only the last session is kept and it never leaves the device
- The streaming quality rows read as ceilings, Up to 1080p, with a note on when a ceiling applies: a slow connection, or a file the server has to convert
```

### What's New (2.2.1), tvOS (734 / 4000)

```text
- Chapters: a film or episode with markers lists them in the player's info panel, and picking one jumps there (#71)
- Photos open the one you actually picked, from an info panel or from the New, Favorites and Search shelves
- Show in Folder arrives with the item on screen and selected instead of scrolling to it later
- Diagnostics, in Settings under About Tomo TV: what the engine did on the last playback, the lane it chose and why it declined a file, the streams your server described, every error, and the version. Only the last session is kept and it never leaves the device
- The streaming quality rows read as ceilings, Up to 1080p, with a note on when a ceiling applies: a slow connection, or a file the server has to convert
```

### What's New (2.2.0), iOS (469 / 4000)

```text
- Downloads: keep an item or a whole folder on the device and play it without the server; offline progress syncs back
- Dolby Vision plays as Dolby Vision, dual-layer discs included
- A mini player keeps music going while you browse, and songs show disc and track instead of S1E1 (#68)
- Folders open in a real navigation bar
- Long-press a search result for its info panel and play it with your place and a queue
- Better handling of playlists with more than 500 items
```

### What's New (2.2.0), tvOS (370 / 4000)

```text
- Dolby Vision plays as Dolby Vision, dual-layer discs included
- Music keeps playing when you leave the player, and songs show disc and track instead of S1E1 (#68)
- Long-press a search result for its info panel and play it with your place and a queue
- Library tiles say what they count: episodes, tracks, photos
- Better handling of playlists with more than 500 items
```

---

## App Name (30 characters max)

**Tomo TV, a Jellyfin Client**
(26 characters. Read off the live listing 2026-08-19.)

---

## Subtitle/Tagline (30 characters max)

**Movies, Shows, Music in 4K HDR**
(30 characters)

Was, through 2.1.0: "Stream Movies, Shows & Music" (28). Apple asks a subtitle to
"highlight features or typical uses" and to avoid generic descriptions; the old
line described every media app and spent 28 of the 160 indexed characters on head
terms an indie will not win. This keeps every term but "Stream" (which survives in
the keyword field as "streaming") and adds 4K and HDR, freeing keyword budget.

---

## Promotional Text (170 characters max)

**Finds your Jellyfin server on the network, nothing to type. Stream at the right quality straight away. Plays it all in Apple's own player.**
(138 characters)

Was, through 2.1.0: "Play your Jellyfin library on Apple TV without a server
transcode. Dolby Atmos passes through untouched, surround stays surround. Just hit
play." Atmos is the deepest feature but the narrowest hook, and the description
carries it two sections down. Setup, the measured link and the system player are
what a stranger judges the app on before they own a single Atmos track.

Was, through 2.0: "Stream any video from your Jellyfin server. Automatic transcoding,
multi-audio switching, and subtitles. Just hit play. No codec headaches. Made for
Apple TV." Leading with transcoding described the app 2.0 replaced.

---

## Description (4,000 characters max)

Rewritten for 2.2.0 (3,385 characters). The description is NOT indexed for App
Store search, so its only job is conversion; Apple: "Don't add unnecessary
keywords to your description in an attempt to improve search results." Shape
follows Apple's stated ideal, "a concise, informative paragraph followed by a
short list of main features", and the first sentence carries the pitch because
that is all most people read before tapping more.

Tomo TV plays your Jellyfin library in Apple's own player. Free, open source, and almost nothing has to go through your server's transcoder.

Your Apple TV, iPhone and iPad do the work a server usually does. H.264 and HEVC play straight from the file in any container. Older and stranger formats are converted on the device itself. Your server only steps in for the rare case nothing else covers.

WHAT MAKES IT DIFFERENT

- Apple's own player, with the controls, gestures and swipe-down panel you already know. AirPlay and Picture in Picture come with it.
- Quality that adapts while the film keeps running. If your connection dips, the picture steps down and climbs back on its own, with nothing to choose and no trip back to the start.
- Sound that does not step down with it. Dolby Atmos passes through untouched, and TrueHD, DTS-HD Master Audio, PCM and FLAC are carried losslessly. When the picture adapts, the audio is not re-encoded along with it.
- Downloads on iPhone and iPad. Keep an item or a whole folder on the device and play it with no server in reach; where you got to is held and syncs back the next time there is one.
- Disc subtitles handled on the device. PGS, VobSub, DVB and XSUB are decoded to timed bitmaps and drawn over the video, so the picture stays stream-copied.
- A server that stays found. If its address changes later, the app recognises the same server by its identity and reconnects, instead of asking you to sign in again.

WHAT YOU GET

- Movies, shows, seasons, collections, music, playlists and photos
- Search across titles, genres, artists and years
- Continue Watching in sync with your server, with the next episode already lined up
- Top Shelf on Apple TV, putting Continue Watching on the home screen
- Up Next between episodes, plus a queue tab inside the player
- Skip Intro and Skip Credits when your server provides the markers
- Long press any card for cast, ratings, plot and full technical detail, plus Resume, Favorite and watched
- Several audio tracks, switchable during playback
- Your subtitle choice remembered from one episode to the next
- Music and audiobooks in a gapless queue player with Lock Screen controls
- Photo viewer and slideshow
- Filters by favorite, genre, artist, year and played state, with shuffle
- Several servers, several users on each, and switching between them without typing a password again

SET UP IN SECONDS

- Scan Network sweeps your subnet and lists every Jellyfin server it finds, nothing to type
- Quick Connect: approve from any Jellyfin app, no password on the remote
- Or type just an IP, and the protocol and port are found for you
- Demo mode: try the whole app on Jellyfin's public demo server before connecting anything

QUALITY

Auto is the default, and it measures rather than guesses. The app times the connection to each server, remembers it per network, and opens at the quality that connection carries, with your original file as the ceiling. Fixed presets from 480p to 4K are there if you would rather set the ceiling yourself.

PRIVACY

No analytics. No tracking. No ads. No account with us. Your credentials stay in the device Keychain, and video streams straight from your server to your device.

Tomo TV is a free, open-source, independent client for Jellyfin and is not affiliated with or endorsed by the Jellyfin project. Jellyfin is a trademark of its respective owner.

Three claims were cut or corrected against code. "Ambient artwork backdrops while
you browse" was FALSE: components/ambient-background.tsx:48-49 ships one static
baked canvas, and the focus-driven artwork wash "was tried and pulled". "no
restart" on multi-audio holds only on the multi-audio HLS lane
(services/multiAudioLoader.ts:5-6); the fallback rebuilds via
RETRY_WITH_TRANSCODE (hooks/useVideoPlayback.ts:811-844). "background playback on
iPhone" understated it: services/audioQueuePlayer.ts:71 gates on Platform.OS ===
"ios", true on tvOS too.

Three things were added that the old copy omitted entirely: adaptive streaming
(services/localRemux.ts:156-160), audio surviving intact when video steps down
(services/localRemux.ts:176-193, the tier is video-only and audio rides a shared
group), and server re-discovery after an address change
(services/connectionRecovery.ts:1-16, "a URL swap, never a logout").

Two hedges are deliberate. "almost nothing has to go through your server's
transcoder" honours memories/CLAUDE-roadmap.md:16, never claim "plays everything"
absolutely. "steps down and climbs back" avoids promising zero reload, since
slipstreamEligible (services/localRemux.ts:168-174) excludes HDR, which adapts on
the server lane instead.

---

## Keywords (100 characters max, comma-separated)

**media,player,downloads,server,nas,atmos,dolby,surround,hevc,codec,mkv,subtitle,selfhosted,audiobook**
(99 characters)

This field is a fifth of everything the app ranks on: the indexed surface is only
name (30) + subtitle (30) + keywords (100). The description, promotional text and
release notes are not indexed at all.

Keywords Strategy:

- "media", "server", "nas" (adjacent searches; kept separate rather than as the
  phrase "media server", since Apple combines terms across the fields anyway)
- "atmos", "dolby", "surround" (the formats the app actually preserves; the audience
  searching for a Jellyfin client is the audience that knows what these mean)
- "codec", "hevc", "mkv" (technical users searching for solutions)
- "selfhosted", "audiobook", "subtitle", "downloads" (identity and use-case terms
  no competitor fields; "downloads" matches the singular too)

Nothing here repeats a word in the app name or subtitle. Rule: never spend the
field on a term already carried by "Tomo TV, a Jellyfin Client" or "Movies, Shows,
Music in 4K HDR".

Changed for 2.2.0: dropped "jellyfin" (already in the NAME, 9 wasted characters),
"tv" (also in the name, 3), "movie" (the subtitle carries "Movies" and Apple
matches singular/plural, 6), "video" and "plex". Added "mkv", "subtitle",
"selfhosted", "audiobook", "downloads".

"downloads" took the slot "streaming" held. Of the fourteen terms it was the only
one with no rationale written down, the name and subtitle do not carry it either,
and a generic high-competition word is the one a small app has least chance of
ranking on. "offline" was the alternative and fits in 97 characters; "downloads"
uses all 99 and matches the singular, so it covers both searches.

"plex" is gone on compliance, not taste. Guideline 2.3.7 bars packing metadata
with "trademarked terms, popular app names", and Apple "may modify inappropriate
keywords at any time". Competitor spillover you cannot rely on is not worth a
standing rejection vector. "atmos" and "dolby" stay: trademarked, but describing a
real capability rather than gaming the system, and already through review.

Through 2.1.0 this line read:
`jellyfin,media,player,video,streaming,plex,server,nas,atmos,dolby,surround,hevc,movie,tv,codec`
Through 2.0:
`jellyfin,media,player,video,streaming,plex,server,nas,local,transcode,hevc,movie,tv,remote,codec`

---

## What's New (4,000 characters max)

### Version 2.2.1

Live on the store is 2.2.0 (confirmed 2026-08-31 by iTunes lookup on trackId
6755077888, released 2026-08-28), so these notes cover only what this build adds
on top of it. One text per platform again: the keyboard, the photo viewer's zoom
and share, the artwork card and the mini player are all absent from tvOS, which
leaves chapters, Diagnostics, the quality note and the two photo fixes there.
Diagnostics has no Copy button on tvOS (app/diagnostics.tsx gates it on IS_TV),
so the tvOS line drops the bug-report sentence.

iOS:

- Pinch to zoom a photo, double tap to zoom to the spot you touched or back out, and share one from its info panel
- Drag left or right to change photo, with no side taps to fight the drag, and drag down to close the viewer
- The photo viewer's close and slideshow are one glass control that opens them out of itself
- Photos open the one you actually picked, from an info panel or from the New, Favorites and Search shelves
- Show in Folder arrives with the item on screen and selected instead of scrolling to it later
- Hardware keyboard on the Mac: space and Return play and pause, the arrow keys seek fifteen seconds, and a double click on a video fills the frame
- The music player's artwork is a rounded card over a wash of itself, clear of the transport bar in any window
- The mini player's skips dim at the ends of the queue, and a press on Pause no longer lands on Next
- Diagnostics, in Settings under About Tomo TV: what the engine did on the last playback, the lane it chose and why it declined a file, the streams your server described, every error, and the version. Copy it into a bug report. Only the last session is kept and it never leaves the device
- The streaming quality rows read as ceilings, Up to 1080p, with a note on when a ceiling applies: a slow connection, or a file the server has to convert

tvOS:

- Chapters: a film or episode with markers lists them in the player's info panel, and picking one jumps there (#71)
- Photos open the one you actually picked, from an info panel or from the New, Favorites and Search shelves
- Show in Folder arrives with the item on screen and selected instead of scrolling to it later
- Diagnostics, in Settings under About Tomo TV: what the engine did on the last playback, the lane it chose and why it declined a file, the streams your server described, every error, and the version. Only the last session is kept and it never leaves the device
- The streaming quality rows read as ceilings, Up to 1080p, with a note on when a ceiling applies: a slow connection, or a file the server has to convert

#71 is the chapters request. #72 is the Mac hardware keyboard request.

### Version 2.2.0

2.1.1 was pulled from review and its work ships here. The store has 2.1.0, whose notes
already covered the engine, Atmos, the music player, Up Next, skip pills, image
subtitles, saved sign-ins, long-press and subtitle memory, so nothing here repeats them.
One text per platform, because Downloads and the mini player are iOS only
(paths.ts downloadsSupported, audio-mini-player.tsx renders null on tvOS) and the
music-keeps-playing fix is tvOS only.

iOS:

- Downloads: keep an item or a whole folder on the device and play it without the server; offline progress syncs back
- Dolby Vision plays as Dolby Vision, dual-layer discs included
- A mini player keeps music going while you browse, and songs show disc and track instead of S1E1 (#68)
- Folders open in a real navigation bar
- Long-press a search result for its info panel and play it with your place and a queue
- Better handling of playlists with more than 500 items

tvOS:

- Dolby Vision plays as Dolby Vision, dual-layer discs included
- Music keeps playing when you leave the player, and songs show disc and track instead of S1E1 (#68)
- Long-press a search result for its info panel and play it with your place and a queue
- Library tiles say what they count: episodes, tracks, photos
- Better handling of playlists with more than 500 items

#68 is the issue that reported the S1E1 badge and the music stopping on Back.

The Dolby Vision line avoids "profile 7", which means nothing to a buyer, and
covers every profile rather than the dual-layer case alone: 2.1.0 declared no
Dolby Vision at all, so all of it is new here. Device verified (f49dc69). Nothing
claims Apple TV bitstreams TrueHD or DTS, which no app can do.

Cut as too small to read: the quality ladder in Settings, artwork crop anchoring,
reversible Clear Progress, the Library tab's Loading label.

### Version 2.1.0

Live. Listing copy entered 2026-08-19.

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
• 4K (2160p) transcoding: stream in Ultra HD quality
• Per-preset H.264 levels for optimal encoding (level 5.1 for 4K)

**Improvements:**
• Updated quality selector with 5 presets (480p through 4K)

---

### Version 1.3.0

**Quick Connect, Sign-In & Continue Watching**

**New Features:**
• Quick Connect: sign in with a code from any Jellyfin device
• Username & password sign-in
• Continue watching: resume where you left off

**Improvements:**
• Larger text for better readability on TV
• Scrolling titles on cards for long names
• Refined settings layout

---

### Version 1.2.0

**Queue Playback, Multi-Audio & Subtitles**

**New Features:**
• Play next queue: videos queue up and auto-continue so you can keep watching
• Up next overlay with progress bar shows what's coming
• Seamless multi-audio track switching during playback
• Subtitle support: external (.srt) and embedded tracks with native tvOS picker
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

**Version:** 2.2.0 (matches app.json). Pick the build number off App Store Connect
before archiving: 2.1.1 uploaded builds under its own version string and was pulled
from review, so nothing here predicts what 2.2.0 may reuse.
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
| Subtitle         | 30    | 30      | ✅     |
| Promotional Text | 170   | 138     | ✅     |
| Description      | 4,000 | 3,385   | ✅     |
| Keywords         | 100   | 99      | ✅     |
| What's New 2.2.0 | 4,000 | 641     | ✅     |

Counted, not estimated (script over this file's own copy; What's New recounted
2026-08-24). App Store Connect shows the count REMAINING, not used, so it will read
32 / 615 / 3,359 under Promotional Text, Description and What's New. Do not
"correct" this table against those numbers.

Only 160 of these characters are indexed for search: App Name, Subtitle and
Keywords. Description, Promotional Text and What's New contribute nothing to
ranking and exist to convert.

---

## Per-Submission Checklist

Done once and still valid:

- [x] Landing page at `https://keiver.dev/lab/tomotv` (Privacy Policy, Support, Marketing URL)
- [x] Icons generated at prebuild by `tvos-assets/plugin`
- [x] Export compliance: `usesNonExemptEncryption: false` in app.json

Regenerated by `npm run shots` from `applestore/captures/`, eight per
set, portrait plus one landscape player shot:

- [x] tvOS screenshots, 3840x2160
- [x] iPhone screenshots, 1320x2868 in the 6.9" slot, player shot 2868x1320
- [x] iPad screenshots, 2064x2752, player shot 2752x2064

Every submission:

- [ ] Bump build number via `npm run archive -- <n>`, reading the last used value off App Store Connect
- [ ] Fill App Review Information → Notes with the block above
- [ ] Physical-device screen recording if this is a platform's first submission
- [x] Update "What's New" (2.2.0 section above)

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
