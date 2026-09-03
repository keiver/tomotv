# Changelog

All notable changes to Tomo TV are documented here.

## [2.2.2]

### Added

- Every codec the engine decodes now plays on the device at any size, 4K VP9 and AV1 included. The engine times its first segment before the player opens; a file this device cannot keep up with plays from the server instead, with nothing to restart, and the app remembers that answer per file until the next update
- A video the server has no poster for shows a frame of itself. The engine opens the file, takes the keyframe a tenth of the way in, and the picture stands on the library cards and shelves, the info panel, the Up Next card, the Apple TV player's Up Next tab and the player's own artwork. Frames are made one at a time as cards come on screen, a card that scrolls away withdraws its request, and a downloaded item's frame comes from the file on the device. They keep in a 64 MB pool on the device, oldest out first
- Chapters on Apple TV show a picture for every marker, whether or not the server extracted chapter images. Where it did not, the engine takes the keyframe at the chapter's start, or the last one before it, from the file on a connection of its own as soon as playback starts, and keeps it for the next play
- A folder the server has no picture for shows its first videos as a collage on its card, the first across the top and the others side by side below, in the order the folder opens, and its info panel takes the same picture. A season without a poster of its own draws the series poster
- A download without a server poster keeps the engine's keyframe beside its media, so the Downloads list draws the same picture the grid does with no server, and downloads held before this get theirs on the next launch
- Send to iPhone on the Apple TV's Diagnostics screen: the last playback goes into your account's own settings slot on your Jellyfin server, one slot per Apple TV. Tomo TV on iPhone or iPad offers it once when it arrives, to view or to email with the whole log in the body, and lists each sending device as a row under About Tomo TV, with Copy and Share. Apple TV has no clipboard, and this is the only place the log ever goes
- Share on the iPhone and iPad Diagnostics screen hands the log to Mail and the rest of the share sheet as a text file

### Changed

- The Diagnostics reading drops the second person and names what it measures, the note about the log sits at the foot of the card, and Copy is a button in the bar

- The Open Source page heads with two centred pills, the build and the app title, over one line, and off Apple TV the credits card caps at five rows and scrolls inside
- The leading tile on every settings row keeps one width and one glyph size, and only its height follows the text beside it

### Fixed

- On Apple TV, a file with chapter images could not start playing until every image had downloaded (#75). The pictures load on their own after playback starts
- A picture kept for one server never stands in for another server's item of the same id: switching server or account empties the frame pool along with the other caches
- File sizes under a megabyte read in kilobytes instead of 0 MB
- After a restart, Diagnostics showed the last playback that ended or failed, not the last one played, and a session left by an older build appeared under the current build's name. Every event is now written as it happens, and the session carries the build that recorded it

## [2.2.1]

### Added

- Chapters on Apple TV: a film or episode with chapter markers lists them in the player's info panel, and picking one jumps there (#71)
- Hardware keyboard on the Mac: Escape goes back, space and Return play and pause whatever is playing, the arrow keys seek fifteen seconds in a video or a track, Command with the arrow keys changes track, Command F opens Search and Command comma opens Settings. Every one of them steps aside while you are typing, and the unmodified keys exist only while something is there to answer them, so a grid keeps its arrow scrolling and a focused control keeps space and Return (#72)
- Pinch to zoom a photo, drag it around once it is zoomed, and double tap to zoom to the point you touched or to put it back
- Drag left or right to change photo on iPhone and iPad, and drag down to close the viewer. Tapping the sides no longer steps, which is what used to override the drag
- Share a photo from its info panel, through the system share sheet
- The arrow keys step through photos in the viewer on the Mac, and a double click on a video fills the frame or restores the letterbox
- Diagnostics, under About Tomo TV in Settings: what the engine did on the last playback, video or music. The lane it chose and its reason when it declined a file, the source as your server describes it, every error, and the build's version. iPhone and iPad can copy the log. Only the last session is kept and it never leaves the device

### Changed

- On iPhone, iPad and Mac the music player's artwork is a rounded card over a blurred wash of itself, sized to stay clear of the transport bar in any window. The card takes the artwork's own shape, so a 4:3 cover no longer sits in bands, and Apple TV shows the same card in place of the disc
- The streaming quality rows read as ceilings, Up to 1080p, and a note under them says when a ceiling applies at all: a slow connection, or a file the server has to convert. Everything else plays at its original resolution
- The photo viewer's close and slideshow are one control at the top left. Pressing it opens them both out of itself, and they merge back in when it closes. It fades while you leave it alone and comes back on a touch, a key or a moved pointer, and an open menu holds it there

### Fixed

- Opening a photo from its info panel showed the folder's first photo instead of the one that was pressed
- A photo opened from the New, Favorites or Search shelves went to the video player, which said it could not be played
- Show in Folder landed on the folder with nothing selected, then scrolled to the item once you had already started browsing
- The mini player's previous and next did nothing at the ends of the queue instead of showing they could not move, and a press on the right of Pause landed on Next
- The music player's poster could disappear in a landscape window

## [2.2.0]

### Added

- Downloads on iPhone and iPad: keep an item or a whole folder on the device and play it with the server switched off, out of range, or gone. A Downloads tab lists what is stored, folders group their own items, and a gauge at the foot of the card shows what the downloads take and what is left free. Holding that gauge is what clears them, and nothing else does. Apple TV has no persistent storage of its own, so it has no Downloads tab
- Positions you reach with no server are held and sent up the next time the app can reach it, so an episode watched offline is where you left it everywhere else
- Dolby Vision plays as Dolby Vision. Single-layer files ride a straight copy. The dual-layer discs Apple hardware cannot decode are folded into one layer on the device as they play, which costs what a copy costs
- A player control rides above the app while music plays, draggable to any corner and tucking itself out of the way when you leave it alone. Holding its artwork stops playback
- Songs carry their disc and track number on the card, in the info panel's details, and under the title in the player
- The info panel offers the play actions a folder actually holds: Play Videos, Play Music, Slideshow, or Open when there is nothing to play
- Long press a search result for the same info panel the shelves give you, and play it with its resume position and a queue

### Changed

- Folders on iPhone and iPad open in a real navigation bar, with the folder's own name as the back label and Filters as a bar button, so the custom header is gone
- Library tiles name what they are counting instead of showing a bare number: episodes, tracks, photos, or the items in a collection or playlist
- Each streaming quality preset states the connection speed it needs, and the Video Quality heading reads out the measured rate
- The build's version appears on the Settings Open Source row while you hold it down, instead of sitting on the row
- Artwork crops from the top, so faces survive a wide card
- Clearing progress from the info panel is reversible while the panel is open, and only written when you close it

### Fixed

- Songs were labelled with a season and episode tag (S01E01) instead of their track number (#68)
- Music stopped when you left the player on Apple TV to browse. The queue keeps playing, and opening the track again brings the player back (#68)
- The Apple TV player's Up Next panel called a queued song "Episode 5"
- Show in Folder was offered on an item you were already viewing inside its own folder
- Playlists longer than 500 items played only their first 500
- A folder that failed to load said it was empty instead of saying the server did not answer
- A long plot cut at its limit could leave a fragment of a tag or a broken character on screen
- Marking an item watched or favorite from the info panel reported success even when the server refused the write
- A picture-in-picture window detached from the app could not be closed once nothing was left to return to
- The Library tab showed a Loading label on its first open
- The Continue row jumped away from its first card after you removed an item from it

## [2.1.0]

### Added

- Playback starts fast on slow servers and connections: the app measures the link to each server and remembers it, and a link that cannot carry the file opens on a smaller feed immediately instead of buffering toward full quality
- Settings shows the measured server link: a signal ladder and a "carries up to" verdict in the Video Quality heading, presets marked when they sit above your link, and an Auto row that states where sessions will start
- Resuming opens the stream at the saved position instead of buffering the beginning first, for both server and on-device sessions
- A video that silently stops advancing recovers on its own: direct play re-routes at the playhead, and a starved on-device session restarts where it was
- Music and audio files play in a dedicated native queue player: gapless track transitions, background playback on iPhone, Now Playing and Lock Screen controls, and previous/next on the Apple TV remote
- Up Next tab in the Apple TV player's swipe-down panel, for both video and music: the remaining queue as selectable poster cards; picking one jumps playback there and closes the panel
- Skip Intro and Skip Credits pills on Apple TV when the server provides segment markers
- Image subtitles (PGS, DVD/VobSub, DVB, XSUB) play in the native player, decoded on the device and drawn over the video, so a disc rip whose only subtitles are pictures keeps its original video and lossless audio instead of being re-encoded by the server
- Continue Watching shows an item inside the folder it belongs to
- Your subtitle choice carries between items: a language you pick, or switching subtitles off, is remembered and applied to whatever you play next. With nothing remembered, the file's own default track is used
- Saved sign-ins: each server card remembers who signed in and offers Continue as that user, reconnecting with the saved session instead of asking for a password. Several accounts on one server each get their own entry, Switch Server is its own screen, and signing out keeps saved sign-ins so coming back is one tap
- Long-press any card for an info panel: artwork, plot and detail rows for every item kind, with Resume and its progress, Favorite, mark watched, Show in Folder, and Clear Progress
- Resume progress shows on every card, not just the Continue Watching row
- Library tiles show item counts, and cards carry a badge for their media kind

### Changed

- Auto is the default video quality: original quality when the link carries it, adaptive when it does not. The fixed presets are named by what they control (4K down to 480p) and act as ceilings, so a preset above the measured link opens lower and climbs toward it instead of rebuffering
- Server conversions use shorter segments, so converted playback is ready sooner on slow servers
- Far more video plays on the device instead of being converted by the server. DivX 3, Theora, DV camcorder footage, Cinepak, H.266/VVC, RealVideo, and the QuickTime and screen-capture formats now play locally, as do RealAudio, ATRAC, WavPack, Musepack and QDesign soundtracks. Files whose colour did not survive the old conversion, ProRes and DV in particular, are handled correctly now
- Dolby Digital, Dolby Digital Plus and Dolby Atmos now reach your receiver untouched. The soundtrack is passed through exactly as it is stored instead of being decoded on the device, so Atmos stays Atmos
- Surround and lossless soundtracks keep their quality on the device. Dolby TrueHD, DTS, DTS-HD Master Audio, PCM and FLAC are now carried losslessly instead of being re-encoded to 192 kbps AAC, and FLAC and Apple Lossless tracks pass through untouched
- Surround layouts arrive intact: 6.1 and 7.1 soundtracks keep every channel, where they were previously folded down to 5.1, and 24-bit sources stay 24-bit
- The between-episodes Up Next screen on Apple TV is now the system's native proposal card: the next episode's poster over the ending video, a live countdown, and Play Now / Close; iPhone keeps the full-screen announcement
- The Apple TV tab bar picks up the system's Liquid Glass material on tvOS 26 and later; earlier systems keep the solid look
- Help is now a section inside Settings instead of a tab of its own
- Adding a server swaps the Add Server button for the address field in the same slot, so the rows below it never shift
- The app version now appears on the Apple TV spine and the phone's library masthead rather than in Settings, and the Open Source link shows only while connected
- Ambient backdrops are baked and pre-decoded at startup, so screens open on a finished canvas, and native Search sits on one too
- Switching servers re-measures the link, so quality decisions follow the server you are on

### Fixed

- Subtitle tracks the file marks as forced are selectable again instead of vanishing from the picker
- A file whose subtitles are all marked forced now shows them even when the on-device engine cannot take it: the server paints them into the picture instead of playing with nothing on screen. Skipped if you have subtitles switched off
- Files with no subtitles no longer offer an empty Closed Captions option that draws nothing
- Back now walks the login steps one at a time; previously it collapsed focus to the tab bar, where a second press quit the app
- Opening the app before the device is unlocked no longer shows the connect screen as though you were signed out. Your credentials are read again and the app catches up on its own once you unlock
- Seasons with no files behind them and missing or unaired episodes no longer appear as items that open into nothing

## [2.0.0]

### Added

- On-device playback engine: H.264 and HEVC in any container (MKV, AVI, WMV, and more) play by stream copy without server transcoding; unsupported audio (AC3, TrueHD, MP3) converts to AAC on the device; legacy video codecs (VP8/VP9, MPEG-1/2/4, WMV, VC-1, H.263, FLV, RealVideo, VP6) transcode locally via VideoToolbox for sources up to 1080p, 8-bit, progressive
- Multi-audio track switching served straight from the on-device engine
- Text subtitles stay selectable in the native player during on-device playback
- HDR10 and HLG pass through with the correct video range declared to the player
- Original quality preset (untouched quality, now the default), listed first under Video Quality
- Up Next between episodes: a full-screen announcement with the next episode's art over a blurred backdrop, a 5-second countdown, and Play Now / Close buttons
- iPhone and iPad support: touch-tuned layouts, responsive columns, native player controls, safe-area handling
- Top Shelf on Apple TV: a live Continue Watching row on the home screen; selecting an item deep-links straight into playback
- Continue Watching keeps the binge going: finishing an episode puts the next unplayed one from that series or folder on the row, homevideos folders included
- Long-press a card to mark it watched or unwatched, with an instant checkmark
- Season and episode tags on video cards, from server metadata or parsed from the filename
- Automatic reconnection when the server's LAN address changes: the app re-finds the server by its identity, no re-login; an unreachable server shows a clear error state with Retry instead of logging you out
- Refreshed app icon, with true parallax layers on Apple TV
- Open-source acknowledgements screen (FFmpeg, GnuTLS, dav1d, and friends) under Help
- Loading bar with the folder name replaces the spinner when opening folders
- Picture in Picture on iPhone and iPad: playback continues in a floating window, and starts automatically when you leave the app mid-video
- The iPhone player opens in the system full-screen player for video and audio: the close button is always available, and swipe-down dismisses
- AirPlay and the Lock Screen show the playing video's poster and title
- The connected server card in Settings shows which account is signed in

### Changed

- Library tab is now Home; Continue Watching progress is drawn into the card title bar
- Continue Watching episodes queue the rest of their series for binge playback
- The folder header (breadcrumb and Filters) floats over the grid under a gradient scrim, so it never scrolls away
- Help tab redesigned around an icon-forward feature index
- Burn In Image Subtitles toggle removed: image subtitles still burn in automatically when the server transcodes
- Forced subtitles no longer burn into the picture when they are text. Only image tracks (PGS, DVDSUB) do, because AVPlayer cannot render bitmaps; forced text tracks ship as selectable renditions instead, so those files keep direct play and stream copy rather than being re-encoded by the server
- App icons for tvOS and iOS are generated at build time from a single set of brand source images
- The phone search field and the connect flow inputs share the settings sunken-card look, with a gold sweep along the search field's bottom edge while a query is in flight

### Fixed

- Backing out of a video quickly no longer wipes the server resume point
- Resume positions no longer corrupt when episodes auto-advance
- Resuming from Continue Watching starts where the row said it would, without a stale refetch
- Menu on Apple TV pops back one screen natively everywhere
- Seeking with the remote in audio playback works on hardware and no longer sticks in pause
- Focus lands on the first card when a folder opens, and no longer over-scrolls past the last row
- Jellyfin 12 compatibility: the deprecated lowercase `api_key` query parameter is now sent as `ApiKey`, so streams, images, and subtitles keep authenticating

## [1.8.0] - 2026-07-29

### Added

- Scan Network on the connect screen: sweeps the local subnet for Jellyfin servers and lists the ones it finds, so there is no address to type. The device's real netmask is honored, so a /23 is covered end to end rather than just the device's own /24
- The connect screen shows this device's own IP address
- Entering a private IP that is not on this device's subnet now says so

### Changed

- A failed connection lists every address that was tried and how each one failed, instead of one generic message
- Connect probes wait longer for a cold server to answer its first request

### Fixed

- Reverse-proxy addresses with a subpath (for example `10.0.0.5/jellyfin`) no longer produce malformed URLs like `https://10.0.0.5/jellyfin:8920`. A subpath also implies a proxy on 443/80, so those are now tried before Jellyfin's own ports

## [1.7.0] - 2026-07-15

### Added

- Filters panel: filter a library by Favorites, genre, artist, or year, with a shuffle toggle; shuffle plays the entire filtered set in a fresh random order that loops
- Favorite hearts: favorited items show a gold heart while browsing, not only under the Favorites filter; long-press a card to add or remove a favorite
- Image-based subtitles (PGS, DVDSUB) and forced foreign-language subtitles burn into the video during transcoding so they display on Apple TV
- Resume positions sync to the server during playback, so you can resume where you left off across devices

### Changed

- Filter selections are scoped per library and carry over as you browse into sub-folders
- The folder header (Filters button and breadcrumb) stays pinned at the top and shows the current library name as a faint oversized title
- Revisiting a folder restores instantly from cache instead of showing a loading spinner

### Fixed

- Apple TV focus in folders and the Filters panel: Up from the top row reliably reaches the Filters button, focus is never lost when opening or returning to a loading or empty folder, and it no longer slips up to the tab bar
- Favorite hearts paint from the authoritative favorites set, so they stay correct after toggling
- Folders with many items paginate correctly when the server omits a total count

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
