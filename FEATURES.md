# Tomo TV features

Tomo TV is a Jellyfin client for Apple TV, iPhone, iPad and Mac. This file lists what it supports on each platform, one row per feature: Yes means the feature is in the app on that platform, No means it is not.

| Platform | Requires                                    |
| -------- | ------------------------------------------- |
| Apple TV | tvOS 16.4 or later                          |
| iPhone   | iOS 16.4 or later                           |
| iPad     | iPadOS 16.4 or later                        |
| Mac      | macOS 13.4 or later, Apple silicon or Intel |

Every feature needs a Jellyfin server. The Notes column says when a feature also depends on a server version, a server setting or an account permission.

## Playback

| Feature                                                 | Apple TV | iPhone, iPad | Mac | Notes                                                                                      |
| ------------------------------------------------------- | -------- | ------------ | --- | ------------------------------------------------------------------------------------------ |
| Apple's system player                                   | Yes      | Yes          | Yes |                                                                                            |
| H.264 and HEVC from any container, copied on the device | Yes      | Yes          | Yes | No server transcode                                                                        |
| Other video codecs converted on the device              | Yes      | Yes          | Yes | List in [playback coverage](docs/playback-coverage.md)                                     |
| AV1                                                     | Yes      | Yes          | Yes | Copied where the hardware decodes it, converted on the device where it does not            |
| Server transcode as the fallback                        | Yes      | Yes          | Yes | Codecs the device cannot decode, or a conversion too slow for it                           |
| 4K, HDR10, HLG                                          | Yes      | Yes          | Yes |                                                                                            |
| Dolby Vision                                            | Yes      | Yes          | Yes | Profile 7 is rewritten to 8.1 on the device                                                |
| Interlaced video deinterlaced on the device             | Yes      | Yes          | Yes |                                                                                            |
| AirPlay                                                 | Yes      | Yes          | Yes | Enabled on the system player                                                               |
| Picture in Picture                                      | Yes      | Yes          | Yes | Video only                                                                                 |
| Now Playing info while video plays                      | No       | Yes          | Yes | On the Lock Screen on iPhone and iPad                                                      |
| Resume and Continue Watching                            | Yes      | Yes          | Yes | Synced with the server                                                                     |
| Resume opens at the saved position                      | Yes      | Yes          | Yes |                                                                                            |
| Hold Resume to play from the beginning                  | Yes      | Yes          | Yes | Asks first                                                                                 |
| Play queue from a folder, season or playlist            | Yes      | Yes          | Yes |                                                                                            |
| Up Next between episodes                                | Yes      | Yes          | Yes | A system card on Apple TV, a screen between episodes elsewhere                             |
| Follows Jellyfin's "Play next episode automatically"    | Yes      | Yes          | Yes |                                                                                            |
| Upcoming queue in the player panel                      | Yes      | No           | No  |                                                                                            |
| Skip Intro and Skip Credits                             | Yes      | No           | No  | Needs the server's Media Segments                                                          |
| Skip commercials                                        | Yes      | Yes          | Yes | A button on Apple TV; automatic elsewhere, a Channel Settings switch that is on by default |
| Chapters in the player panel, with pictures             | Yes      | No           | No  |                                                                                            |
| Favorite from the player controls                       | Yes      | No           | No  |                                                                                            |
| Scrubbing shows frames                                  | Yes      | Yes          | Yes | Dolby Vision frames are converted to SDR at up to 1080p. None on live channels             |
| Multi-episode files show their range, S01E01-E02        | Yes      | Yes          | Yes |                                                                                            |
| Loading screen names what playback is waiting on        | Yes      | Yes          | Yes |                                                                                            |
| Error screen with an error code                         | Yes      | Yes          | Yes |                                                                                            |

## Audio

| Feature                                                       | Apple TV | iPhone, iPad | Mac | Notes                                                                                 |
| ------------------------------------------------------------- | -------- | ------------ | --- | ------------------------------------------------------------------------------------- |
| AAC, ALAC, AC-3, E-AC-3 and well-formed FLAC copied untouched | Yes      | Yes          | Yes | Dolby Atmos in E-AC-3 is preserved                                                    |
| TrueHD, DTS and other codecs decoded on the device            | Yes      | Yes          | Yes | To lossless FLAC, or AAC where FLAC cannot be used; not passed through as a bitstream |
| Switch audio tracks during playback                           | Yes      | Yes          | Yes |                                                                                       |
| Audio language remembered                                     | Yes      | Yes          | Yes | Saved to the Jellyfin account                                                         |

## Subtitles

| Feature                                             | Apple TV | iPhone, iPad | Mac | Notes                                     |
| --------------------------------------------------- | -------- | ------------ | --- | ----------------------------------------- |
| Text subtitles selectable in the player             | Yes      | Yes          | Yes |                                           |
| Embedded text subtitles converted on the device     | Yes      | Yes          | Yes | SubRip, mov_text, ASS, SSA                |
| Picture subtitles: PGS, VobSub, DVB, XSUB, teletext | Yes      | Yes          | Yes | Decoded and drawn on the device           |
| Forced subtitles are selectable tracks              | Yes      | Yes          | Yes | Burned in only when the server transcodes |
| Subtitle language remembered                        | Yes      | Yes          | Yes | Saved to the Jellyfin account             |

## Quality and server transcoding

| Feature                                                          | Apple TV | iPhone, iPad | Mac | Notes                                                 |
| ---------------------------------------------------------------- | -------- | ------------ | --- | ----------------------------------------------------- |
| Auto quality from a measured connection                          | Yes      | Yes          | Yes | The default                                           |
| Quality adapts during playback                                   | Yes      | Yes          | Yes |                                                       |
| Fixed limits: 480p, 540p, 720p, 1080p, 4K                        | Yes      | Yes          | Yes | Apply when the server transcodes                      |
| Server transcoding: When needed, Only for unsupported files, Off | Yes      | Yes          | Yes | The server's own setting for the account overrides it |
| Settings shows the measured connection speed                     | Yes      | Yes          | Yes | Select it to measure again                            |
| Settings shows whether the server allows transcoding             | Yes      | Yes          | Yes |                                                       |

## Library and browsing

| Feature                                                                 | Apple TV | iPhone, iPad | Mac | Notes                                                     |
| ----------------------------------------------------------------------- | -------- | ------------ | --- | --------------------------------------------------------- |
| Home: Libraries, Continue, Favorites and New                            | Yes      | Yes          | Yes |                                                           |
| Movies, shows, music videos, trailers and home videos                   | Yes      | Yes          | Yes |                                                           |
| Collections and playlists                                               | Yes      | Yes          | Yes |                                                           |
| Cards show progress, watched, favorite and episode numbers              | Yes      | Yes          | Yes |                                                           |
| A folder with no picture shows a collage of what it holds               | Yes      | Yes          | Yes |                                                           |
| Info panel: cast, ratings, plot, technical details                      | Yes      | Yes          | Yes | Hold a card to open it                                    |
| Info panel shows how the file will play                                 | Yes      | Yes          | Yes | On the device, re-encoded on the device, or by the server |
| Play All, Play Videos, Play Music, Play Audio or Slideshow for a folder | Yes      | Yes          | Yes |                                                           |
| Show in Folder                                                          | Yes      | Yes          | Yes |                                                           |
| Favorite, mark watched, clear progress                                  | Yes      | Yes          | Yes |                                                           |
| Delete an item from the server                                          | Yes      | Yes          | Yes | Admin accounts, where the server allows it                |
| Swipe an info panel to the next item                                    | No       | Yes          | Yes |                                                           |
| Filters: favorite, played, unplayed, genre, artist, year                | Yes      | Yes          | Yes |                                                           |
| Shuffle                                                                 | Yes      | Yes          | Yes |                                                           |
| Posters generated on the device when the server has none                | Yes      | Yes          | Yes | A setting, on by default                                  |

## Search

| Feature                             | Apple TV | iPhone, iPad | Mac | Notes                        |
| ----------------------------------- | -------- | ------------ | --- | ---------------------------- |
| Titles, genres, artists and years   | Yes      | Yes          | Yes |                              |
| Live TV channels and programs       | Yes      | Yes          | Yes | Programs through tomorrow    |
| Chained terms with a standalone `+` | Yes      | Yes          | Yes | "news + sports" finds either |

## Live TV

| Feature                                                         | Apple TV | iPhone, iPad | Mac | Notes                                          |
| --------------------------------------------------------------- | -------- | ------------ | --- | ---------------------------------------------- |
| Guide by time and channel                                       | Yes      | Yes          | Yes | Today and the 13 days after it                 |
| Channel wall with live previews                                 | Yes      | Yes          | Yes | Previews can be turned off                     |
| Sort channels by number or name                                 | Yes      | Yes          | Yes |                                                |
| Search inside the channel wall                                  | Yes      | No           | No  | Elsewhere a Search button opens the Search tab |
| Favorites, and a Favorites only view                            | Yes      | Yes          | Yes |                                                |
| Your own channel groups: create, rename, delete                 | Yes      | Yes          | Yes |                                                |
| Groups from the tuner's playlist                                | Yes      | Yes          | Yes | M3U tuners on an http or https address         |
| Categories: News, Sports, Kids, Movies, Series                  | Yes      | Yes          | Yes |                                                |
| Add a channel to groups from its info panel                     | Yes      | Yes          | Yes |                                                |
| Offline channels are marked, and can be hidden                  | Yes      | Yes          | Yes |                                                |
| Resize the guide's channel column                               | No       | Yes          | Yes |                                                |
| Recordings and the schedule                                     | Yes      | Yes          | Yes |                                                |
| Record a program or a series                                    | Yes      | Yes          | Yes | Accounts allowed to manage recordings          |
| Record from the player controls                                 | Yes      | No           | No  |                                                |
| Record a channel with no guide for a set length                 | Yes      | Yes          | Yes | 2 hours by default                             |
| Stop All Recordings                                             | Yes      | Yes          | Yes |                                                |
| REC marks on recording channels and programs                    | Yes      | Yes          | Yes |                                                |
| Add XMLTV guide sources                                         | Yes      | Yes          | Yes | For channels the server has no listings for    |
| Guides declared by the tuner's playlist or set on the server    | Yes      | Yes          | Yes | Used with no setup                             |
| Guide source status, matched channels and storage               | Yes      | Yes          | Yes |                                                |
| Playlist channels listed before the server finishes adding them | Yes      | Yes          | Yes | Not for accounts with parental rules           |
| Channels read from their own source when the server allows it   | Yes      | Yes          | Yes | Otherwise through the server                   |
| Captions and subtitles on live channels                         | Yes      | Yes          | Yes | CEA-608/708, DVB, teletext                     |
| Flip channels with the remote                                   | Yes      | No           | No  |                                                |
| Channels panel in the player                                    | Yes      | No           | No  |                                                |
| Live TV tab                                                     | Yes      | No           | No  | Elsewhere Live TV opens from the library       |

## Downloads

| Feature                                                                 | Apple TV | iPhone, iPad | Mac | Notes                                               |
| ----------------------------------------------------------------------- | -------- | ------------ | --- | --------------------------------------------------- |
| Download an item or a whole folder                                      | No       | Yes          | Yes | Video and audio                                     |
| Original, or a smaller copy at 1080p, 720p or 480p                      | No       | Yes          | Yes | Smaller copies need server transcoding              |
| Smaller copies keep one audio track in your language and text subtitles | No       | Yes          | Yes | A picture subtitle you would see is burned in       |
| Pause and resume a download                                             | No       | Yes          | Yes | Originals only                                      |
| Download speed and storage used                                         | No       | Yes          | Yes |                                                     |
| Offline playback                                                        | No       | Yes          | Yes | Progress syncs when the app next reaches the server |
| Shuffle a downloaded folder                                             | No       | Yes          | Yes |                                                     |
| Remove one, a folder, or everything                                     | No       | Yes          | Yes | Hold the storage gauge to remove everything         |

## Music, photos and books

| Feature                                   | Apple TV | iPhone, iPad | Mac | Notes                                      |
| ----------------------------------------- | -------- | ------------ | --- | ------------------------------------------ |
| Music and audiobooks in a queue player    | Yes      | Yes          | Yes |                                            |
| Now Playing controls                      | Yes      | Yes          | Yes | On the Lock Screen on iPhone and iPad      |
| Mini player while browsing                | No       | Yes          | Yes | Drag it anywhere, hold its artwork to stop |
| Upcoming tracks in the player panel       | Yes      | No           | No  |                                            |
| Song details: album, artist, disc, track  | Yes      | Yes          | Yes |                                            |
| Photo viewer and slideshow                | Yes      | Yes          | Yes |                                            |
| Pinch and double tap to zoom a photo      | No       | Yes          | Yes |                                            |
| Photo details: camera, exposure, location | Yes      | Yes          | Yes |                                            |
| Share a photo                             | No       | Yes          | Yes |                                            |
| Books: PDF, EPUB, MOBI, AZW, AZW3, PRC    | Yes      | Yes          | Yes | Reading position saved to the server       |
| Comics: CBZ, CBR, CBT, CB7                | Yes      | Yes          | Yes |                                            |
| Zoom a page                               | Yes      | Yes          | Yes | On Apple TV, PDFs and comics only          |
| Change text size in text books            | Yes      | Yes          | Yes |                                            |

## SyncPlay

| Feature                           | Apple TV | iPhone, iPad | Mac | Notes                                |
| --------------------------------- | -------- | ------------ | --- | ------------------------------------ |
| Join or start a group             | Yes      | Yes          | Yes | Needs SyncPlay access on the account |
| Join code to scan                 | Yes      | Yes          | Yes |                                      |
| Play for Group from an info panel | Yes      | Yes          | Yes |                                      |

## Servers, accounts and setup

| Feature                                     | Apple TV | iPhone, iPad | Mac | Notes                                                          |
| ------------------------------------------- | -------- | ------------ | --- | -------------------------------------------------------------- |
| Several servers, several users on each      | Yes      | Yes          | Yes | Switching needs no password                                    |
| Rename or remove a server, forget a sign-in | Yes      | Yes          | Yes |                                                                |
| Scan Network                                | Yes      | Yes          | Yes | Sweeps the local network                                       |
| Quick Connect                               | Yes      | Yes          | Yes |                                                                |
| Username and password                       | Yes      | Yes          | Yes |                                                                |
| A bare IP finds the protocol and port       | Yes      | Yes          | Yes |                                                                |
| HTTP and HTTPS servers                      | Yes      | Yes          | Yes | HTTP sends your sign-in unencrypted: use HTTPS beyond your LAN |
| Demo server                                 | Yes      | Yes          | Yes | The Jellyfin project's public demo                             |
| A moved server is found again               | Yes      | Yes          | Yes | On the local network, by server identity                       |

## Appearance and language

| Feature                                                 | Apple TV | iPhone, iPad | Mac | Notes                                    |
| ------------------------------------------------------- | -------- | ------------ | --- | ---------------------------------------- |
| Themes: Tomo, Green, Blue, Purple, or your own          | Yes      | Yes          | Yes | Saved themes follow the Jellyfin account |
| Theme editor: hue, saturation, brightness or a hex code | Yes      | Yes          | Yes |                                          |
| Background: Folder artwork, Theme color, Clear          | Yes      | Yes          | Yes |                                          |
| English, German, French, Spanish                        | Yes      | Yes          | Yes | Follows the device or picked in Settings |
| Reduce Motion is honored                                | Yes      | Yes          | Yes |                                          |

## Platform extras

| Feature                                     | Apple TV | iPhone, iPad | Mac | Notes                                                        |
| ------------------------------------------- | -------- | ------------ | --- | ------------------------------------------------------------ |
| Top Shelf                                   | Yes      | No           | No  | Continue Watching and recently played channels               |
| Keyboard shortcuts                          | No       | No           | Yes | Play and pause, seek, tracks, search, settings, photos, zoom |
| Double-click the video to fill or letterbox | No       | No           | Yes |                                                              |

## Diagnostics and privacy

| Feature                                 | Apple TV | iPhone, iPad | Mac | Notes                             |
| --------------------------------------- | -------- | ------------ | --- | --------------------------------- |
| Last playback as a diagnostics document | Yes      | Yes          | Yes |                                   |
| Copy, share or email diagnostics        | No       | Yes          | Yes |                                   |
| Send diagnostics from an Apple TV       | Yes      | No           | No  | Through your own Jellyfin account |
| Receive diagnostics an Apple TV sent    | No       | Yes          | Yes |                                   |
| Licenses and credits                    | Yes      | Yes          | Yes |                                   |
| Analytics, tracking or ad SDKs          | No       | No           | No  |                                   |
| Credentials kept in the Keychain        | Yes      | Yes          | Yes |                                   |

## Not supported

- Servers other than Jellyfin (Plex, Emby)
- Android
- DRM-protected channels
- Password-protected PDFs
