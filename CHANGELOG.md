# Changelog

All notable changes to Tomo TV are documented here.

## [1.6.0] - 2026-07-10

### Added

- Music Videos libraries now list and play their items (MusicVideo was missing from every library query)
- Photo support: photos libraries, photo-enabled home videos libraries, and photo albums now show their pictures
- Full-screen photo viewer: left/right steps photos with a slide animation; play/pause or select starts a 5-second slideshow with a countdown bar and crossfade; Menu exits
- Trailer and audiobook items are now listed and playable
- Album artwork shown during audio-only playback
- Library tiles show real item counts (the server reports a bogus count for library roots)

### Changed

- Jellyfin media-type filters are centralized in one place so new kinds can't silently vanish again (books, live TV, and plugin channels remain intentionally unsupported)
- New card focus treatment: gold glow and border with an opaque gold title bar; count badge is a matching gold pill; decorative folder icon removed
- Accessibility pass: labels on inputs, images and overlays; Reduce Motion honored in marquee, slideshow and ambient background; low-contrast text bumped to 4.5:1; app forced to dark UI style
- Poster art anchors to the top of the card instead of center-cropping

### Fixed

- Library tile counts on Jellyfin 10.11: recursive view queries only honor MediaTypes filters server-side (IsFolder is ignored and IncludeItemTypes returns 0 for most typed libraries), so counts now filter by media type
- A count of 0 never renders as a badge; recursive count falls back to the direct child count
- Focused card glow no longer clipped by the Continue Watching row; resume progress bar inverts colors on focus instead of disappearing against the gold bar

## [1.5.1] - 2026-06-30

### Changed

- Folder browsing uses nested navigation so the Apple TV Menu button backs out one folder level at a time
- Client reports its app version to the server in the authentication header

### Fixed

- tvOS focus no longer gets stuck on, or pops the screen away from, loading or empty folders
- Stale or overlapping folder loads no longer overwrite the current view
- Load-more no longer fires during a refresh, avoiding duplicate or skipped items
- Root-appropriate empty-state copy on the libraries screen
- Correct device name reported on Android and Android TV

## [1.5.0] - 2026-06-23

### Fixed

- Connecting to HTTP and local-network Jellyfin servers on tvOS 16 (added App Transport Security exceptions for media playback and local networking)
- Grid layout refinements from pre-release review

## [1.4.0] - 2026-06-22

### Added

- Saved servers list on the connect screen, shown as selectable cards
- Server auto-discovery from a bare IP or hostname (no full URL needed)
- On-demand restore of the last connection with a reachability check
- Ambient background (dark canvas, soft glows) across all tabs
- Library background tinted by the focused card's poster

### Changed

- Upgraded to Expo SDK 56 (React Native 0.85, React 19.2)
- Search tab hidden until signed in; native search preloaded for instant open
- Grid adapts to content orientation (portrait or landscape) with per-card image fit
- Redesigned cards: frosted title panel, folder count badge, shorter aspect
- Continue Watching moved from a dedicated tab to a Library row
- Watch progress stored on the local filesystem instead of SecureStore
- Breadcrumb labels capped in width for deep paths

### Fixed

- Watch progress now persists on tvOS (cache directory; Documents writes are denied)
- Login (Quick Connect, password, demo) lands on the Library
- Library no longer empty immediately after sign-in
- Stale disconnected load no longer overwrites the library after connecting
- Removed dev-credential mechanism; Quick Connect sessions persist across launches
- Sign-out no longer issues a request with empty credentials
- Help tab no longer shows the version string

## [1.3.4] - 2026-03-21

### Fixed

- Smooth MarqueeText scroll-back animation instead of instant jump
- Stale items flash when navigating between folders
- Container format check now handles Jellyfin's comma-separated Container field
- Native AVPlayer errors (CoreMediaErrorDomain) now correctly classified as decode errors
- Error messages no longer leak raw error strings to the UI

### Changed

- HLS manifest attributes sanitized against malformed metadata
- URL-level native logging (manifest URLs, stream URLs) gated behind DEBUG builds

## [1.3.3] - 2026-03-11

### Changed

- Allow HTTP connections on all networks via `NSAllowsArbitraryLoads` (previously local-only via `NSAllowsLocalNetworking`)
- Loading username correctly when running the app locally with dev env variables

## [1.3.2] - 2026-03-05

### Fixed

- MKV, AVI, and WebM containers now route to transcoding instead of crashing AVPlayer
- Corrected direct play URL to include MediaSourceId

## [1.3.1] - 2026-02-25

### Added

- 4K (2160p) transcoding — stream in Ultra HD quality
- Per-preset H.264 levels for optimal encoding (level 5.1 for 4K)

### Changed

- Updated quality selector with 5 presets (480p through 4K)

## [1.3.0] - 2026-01-24

### Added

- Quick Connect — sign in with a code from any Jellyfin device
- Username & password sign-in
- Continue watching — resume where you left off

### Changed

- Larger text for better readability on TV
- Scrolling titles on cards for long names
- Refined settings layout

## [1.2.0]

### Added

- Play next queue — videos queue up and auto-continue
- Up next overlay with progress bar
- Seamless multi-audio track switching during playback
- Subtitle support — external (.srt) and embedded tracks with native tvOS picker
- Native audio player improvements
- Updated app icons

### Changed

- Enhanced tvOS focus and navigation reliability
- Faster native search loading
- UI and stability fixes

## [1.1.1]

### Changed

- Updated expo-tvos-search to v1.3.1 with improved native search integration
- Removed deprecated UI code for better performance
- Updated settings screen for improved reliability
- Documentation updates for developers
- Minor bug fixes and optimizations

## [1.1.0]

### Added

- Demo mode — try TomoTV instantly with Jellyfin's official demo server
- Full playlist support — browse and play videos from your Jellyfin playlists
- One-tap demo connection in Settings
- Navigate into playlists with breadcrumb navigation

### Changed

- Auto-fetched demo credentials from Jellyfin's public demo server
- Playlist-specific API endpoint for proper Jellyfin integration
- Improved folder type detection for UserView and Playlist types
- Enhanced error handling for demo server connectivity

## [1.0.8]

### Added

- Audio files visible when browsing folders
- Audio files auto-play when selected
- Dedicated audio player UI with play/pause controls

### Changed

- Play/pause button auto-focuses on Apple TV remote
- TV remote select and play/pause buttons toggle playback
- Improved button styling in audio player

## [1.0.7]

### Changed

- Native tvOS search shows error alerts when connection fails
- Debug Info screen protects API key (shows only last 4 characters)
- Improved logging throughout the app
- Cleaner validation flow for server settings

### Fixed

- Silent failures in tvOS native search
- Error recovery during search operations

## [1.0.6]

### Added

- Folder navigation with breadcrumb trail
- Back button in grid for parent folder navigation
- Redesigned Help screen with QR code to documentation

### Changed

- Unified dark background (#1C1C1E) across all screens
- Removed animations for smoother folder navigation
- Better focus feedback with instant border highlights
- Settings sections with elevated card styling

### Fixed

- Jumpiness when switching folders
- Animation lag on app startup

## [1.0.5]

### Added

- Initial release
- Automatic codec detection and transcoding
- 4 quality presets (480p, 540p, 720p, 1080p)
- Library browsing with infinite scroll
- Remote search with live results
- Autoplay playlist (continuous video playback)
- Subtitle support (external tracks embedded automatically)
- Secure on-device credential storage
- Help section with troubleshooting
- Native Apple TV remote support
