# Tomo TV features

What Tomo TV does, by platform. Mac is the Mac Catalyst app.

## Playback

| Feature                                                 | Apple TV | iPhone, iPad | Mac | Notes                                                                        |
| ------------------------------------------------------- | -------- | ------------ | --- | ---------------------------------------------------------------------------- |
| Apple's system player                                   | Yes      | Yes          | Yes |                                                                              |
| H.264 and HEVC from any container, copied on the device | Yes      | Yes          | Yes | No server transcode                                                          |
| Other video codecs converted on the device              | Yes      | Yes          | Yes | List in [playback coverage](docs/playback-coverage.md)                       |
| Server transcode as the fallback                        | Yes      | Yes          | Yes | Codecs the device cannot decode, or a conversion too slow for it             |
| 4K, HDR10, HLG                                          | Yes      | Yes          | Yes |                                                                              |
| Dolby Vision                                            | Yes      | Yes          | Yes | Profile 7 is rewritten to 8.1 on the device                                  |
| Interlaced video deinterlaced on the device             | Yes      | Yes          | Yes |                                                                              |
| AirPlay                                                 | Yes      | Yes          | Yes | Enabled on the system player                                                 |
| Picture in Picture                                      | Yes      | Yes          | Yes | Video only                                                                   |
| Resume and Continue Watching                            | Yes      | Yes          | Yes | Synced with the server                                                       |
| Up Next between episodes                                | Yes      | Yes          | Yes | A system card on Apple TV, a screen between episodes elsewhere               |
| Upcoming queue in the player panel                      | Yes      | No           | No  |                                                                              |
| Skip Intro and Skip Credits                             | Yes      | No           | No  | Needs the server's Media Segments                                            |
| Skip commercials                                        | Yes      | Yes          | Yes | A button on Apple TV, automatic elsewhere when turned on in Channel Settings |
| Chapters in the player panel                            | Yes      | No           | No  |                                                                              |
| Scrubbing shows frames                                  | Yes      | Yes          | Yes |                                                                              |
| Multi-episode files show their range, S01E01-E02        | Yes      | Yes          | Yes |                                                                              |

## Audio

| Feature                                                         | Apple TV | iPhone, iPad | Mac | Notes                              |
| --------------------------------------------------------------- | -------- | ------------ | --- | ---------------------------------- |
| AAC, ALAC, AC-3, E-AC-3 and FLAC copied untouched               | Yes      | Yes          | Yes | Dolby Atmos in E-AC-3 is preserved |
| TrueHD, DTS, MP3 and other codecs decoded to FLAC on the device | Yes      | Yes          | Yes | Not passed through as a bitstream  |
| Switch audio tracks during playback                             | Yes      | Yes          | Yes |                                    |

## Subtitles

| Feature                                   | Apple TV | iPhone, iPad | Mac | Notes                           |
| ----------------------------------------- | -------- | ------------ | --- | ------------------------------- |
| Text subtitles selectable in the player   | Yes      | Yes          | Yes |                                 |
| Picture subtitles: PGS, VobSub, DVB, XSUB | Yes      | Yes          | Yes | Decoded and drawn on the device |
| Subtitle language remembered              | Yes      | Yes          | Yes | Saved to the Jellyfin account   |

## Quality and server transcoding

| Feature                                                          | Apple TV | iPhone, iPad | Mac | Notes                                                 |
| ---------------------------------------------------------------- | -------- | ------------ | --- | ----------------------------------------------------- |
| Auto quality from a measured connection                          | Yes      | Yes          | Yes | The default                                           |
| Quality adapts during playback                                   | Yes      | Yes          | Yes |                                                       |
| Fixed limits: 480p, 540p, 720p, 1080p, 4K                        | Yes      | Yes          | Yes | Apply when the server transcodes                      |
| Server transcoding: When needed, Only for unsupported files, Off | Yes      | Yes          | Yes | The server's own setting for the account overrides it |

## Library and browsing

| Feature                                                  | Apple TV | iPhone, iPad | Mac | Notes                                      |
| -------------------------------------------------------- | -------- | ------------ | --- | ------------------------------------------ |
| Libraries, folders and playlists                         | Yes      | Yes          | Yes |                                            |
| Info panel: cast, ratings, plot, technical details       | Yes      | Yes          | Yes |                                            |
| Favorite, mark watched, clear progress                   | Yes      | Yes          | Yes |                                            |
| Delete an item from the server                           | Yes      | Yes          | Yes | Admin accounts, where the server allows it |
| Swipe an info panel to the next item                     | No       | Yes          | Yes |                                            |
| Filters: favorite, played, unplayed, genre, artist, year | Yes      | Yes          | Yes |                                            |
| Shuffle                                                  | Yes      | Yes          | Yes |                                            |
| Posters generated on the device when the server has none | Yes      | Yes          | Yes | A setting, on by default                   |

## Search

| Feature                             | Apple TV | iPhone, iPad | Mac | Notes                        |
| ----------------------------------- | -------- | ------------ | --- | ---------------------------- |
| Titles, genres, artists and years   | Yes      | Yes          | Yes |                              |
| Live TV channels and programs       | Yes      | Yes          | Yes | Programs through tomorrow    |
| Chained terms with a standalone `+` | Yes      | Yes          | Yes | "news + sports" finds either |

## Live TV

| Feature                                        | Apple TV | iPhone, iPad | Mac | Notes                                       |
| ---------------------------------------------- | -------- | ------------ | --- | ------------------------------------------- |
| Guide by time and channel                      | Yes      | Yes          | Yes | Today and the 13 days after it              |
| Channel wall with live previews                | Yes      | Yes          | Yes |                                             |
| Favorites and your own channel groups          | Yes      | Yes          | Yes |                                             |
| Groups from the tuner's playlist               | Yes      | Yes          | Yes |                                             |
| Categories: News, Sports, Kids, Movies, Series | Yes      | Yes          | Yes |                                             |
| Hide offline channels                          | Yes      | Yes          | Yes |                                             |
| Recordings and the schedule                    | Yes      | Yes          | Yes |                                             |
| Record a program or a series                   | Yes      | Yes          | Yes | Accounts allowed to manage recordings       |
| Add XMLTV guide sources                        | Yes      | Yes          | Yes | For channels the server has no listings for |
| Flip channels with the remote                  | Yes      | No           | No  |                                             |
| Live TV tab                                    | Yes      | No           | No  | Elsewhere Live TV opens from the library    |

## Downloads

| Feature                                            | Apple TV | iPhone, iPad | Mac | Notes                                               |
| -------------------------------------------------- | -------- | ------------ | --- | --------------------------------------------------- |
| Download an item or a whole folder                 | No       | Yes          | Yes |                                                     |
| Original, or a smaller copy at 1080p, 720p or 480p | No       | Yes          | Yes | Smaller copies need server transcoding              |
| Offline playback                                   | No       | Yes          | Yes | Progress syncs when the app next reaches the server |

## Music, photos and books

| Feature                                 | Apple TV | iPhone, iPad | Mac | Notes                                |
| --------------------------------------- | -------- | ------------ | --- | ------------------------------------ |
| Music and audiobooks in a gapless queue | Yes      | Yes          | Yes |                                      |
| Mini player while browsing              | No       | Yes          | Yes |                                      |
| Photo viewer and slideshow              | Yes      | Yes          | Yes |                                      |
| Share a photo                           | No       | Yes          | Yes |                                      |
| Books: PDF, EPUB, MOBI, AZW, AZW3, PRC  | Yes      | Yes          | Yes | Reading position saved to the server |
| Comics: CBZ, CBR, CBT, CB7              | Yes      | Yes          | Yes |                                      |

## SyncPlay

| Feature               | Apple TV | iPhone, iPad | Mac | Notes |
| --------------------- | -------- | ------------ | --- | ----- |
| Join or start a group | Yes      | Yes          | Yes |       |
| Join code to scan     | Yes      | Yes          | Yes |       |

## Servers, accounts and setup

| Feature                                | Apple TV | iPhone, iPad | Mac | Notes                                    |
| -------------------------------------- | -------- | ------------ | --- | ---------------------------------------- |
| Several servers, several users on each | Yes      | Yes          | Yes | Switching needs no password              |
| Scan Network                           | Yes      | Yes          | Yes | Sweeps the local network                 |
| Quick Connect                          | Yes      | Yes          | Yes |                                          |
| Username and password                  | Yes      | Yes          | Yes |                                          |
| A bare IP finds the protocol and port  | Yes      | Yes          | Yes |                                          |
| Demo server                            | Yes      | Yes          | Yes | The Jellyfin project's public demo       |
| A moved server is found again          | Yes      | Yes          | Yes | On the local network, by server identity |

## Appearance and language

| Feature                                        | Apple TV | iPhone, iPad | Mac | Notes                                    |
| ---------------------------------------------- | -------- | ------------ | --- | ---------------------------------------- |
| Themes: Tomo, Green, Blue, Purple, or your own | Yes      | Yes          | Yes | Saved themes follow the Jellyfin account |
| Background: Folder artwork, Theme color, Clear | Yes      | Yes          | Yes |                                          |
| English, German, French, Spanish               | Yes      | Yes          | Yes | Follows the device or picked in Settings |

## Platform extras

| Feature            | Apple TV | iPhone, iPad | Mac | Notes                                          |
| ------------------ | -------- | ------------ | --- | ---------------------------------------------- |
| Top Shelf          | Yes      | No           | No  | Continue Watching and recently played channels |
| Keyboard shortcuts | No       | No           | Yes | Play and pause, seek, search, settings, photos |

## Diagnostics and privacy

| Feature                                 | Apple TV | iPhone, iPad | Mac | Notes                             |
| --------------------------------------- | -------- | ------------ | --- | --------------------------------- |
| Last playback as a diagnostics document | Yes      | Yes          | Yes |                                   |
| Share diagnostics                       | No       | Yes          | Yes |                                   |
| Send diagnostics to your phone          | Yes      | No           | No  | Through your own Jellyfin account |
| Analytics, tracking or ad SDKs          | No       | No           | No  |                                   |
| Credentials kept in the Keychain        | Yes      | Yes          | Yes |                                   |

## Not supported

- Servers other than Jellyfin (Plex, Emby)
- Android
- Downloads on Apple TV
- Picture in Picture for audio-only items
- TrueHD or DTS passed through as a bitstream
- Searching for subtitles from inside the player
- An Apple Watch app
- Shared library folders
