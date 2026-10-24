# App Store Metadata for TomoTV

**Last Updated:** October 13, 2026

## Quick Reference

**Category:** Deployment
**Keywords:** App Store, metadata, screenshots, description, keywords, ASO, privacy policy

Complete App Store metadata including app name, description, keywords, screenshots, privacy policy, and marketing copy.

## Related Documentation

- [`CLAUDE-tvos-icons.md`](./CLAUDE-tvos-icons.md) - Icon and Top Shelf asset generation

## Decisions of record (never re-propose)

- App Store screenshots: iPhone/iPad portrait only, tvOS landscape. 1320x2868 goes in the hidden 6.9" slot. Caption band: gold #FFC312, ink #2B1F05, Space Grotesk SemiBold.
- Naming "Tomo TV, a Jellyfin Client" is the branding doc's own example: never propose a rename or logo change.
- App Review Notes must be filled for any new platform submission; adding a platform is a new-app review.
- What's New: a few short lines, one user benefit each, in the viewer's words. No internals (engine, codecs, M3U/playlist, focus targets, row counts, timings) and no niche fixes; those stay in CHANGELOG.
- iOS 27 Generated Subtitles stay out of copy until approved.

---

## Paste blocks (App Store Connect)

Canonical copy, fenced so it copies clean with no leading whitespace. The
sections further down carry the reasoning, the history and the character-count
table; if they ever disagree with these blocks, **these blocks win**. What the
listing actually carries today is recorded under
[The listing as it stands](#the-listing-as-it-stands); the two are not the same
text.

The 2.2.11 Mac block is release copy for the first Mac Catalyst version, in all
four languages. The uploader omits What's New on a platform's first release;
the offline metadata check still requires the blocks. See
[the release guide](../docs/RELEASING.md) for the Mac listing and manual captures.

### App Name (26 / 30)

```text
Tomo TV, a Jellyfin Client
```

### Subtitle (29 / 30)

```text
Movies, Live TV, Music, Books
```

### Promotional Text (165 / 170)

```text
Free and open source, no ads, no account. Plays Live TV, 4K, Dolby Vision and Dolby Atmos in Apple's own player, and finds your Jellyfin server with nothing to type.
```

### Keywords (99 / 100)

```text
player,downloads,server,nas,atmos,dolby,surround,hevc,mkv,subtitle,selfhosted,audiobook,comics,epub
```

### Description (2,177 / 4000)

```text
Tomo TV plays your Jellyfin library on Apple TV, iPhone, iPad and Mac. Your device plays the file itself: H.264 and HEVC in any container, including 4K, HDR10, HLG and Dolby Vision. Most other formats are converted on the device. Your server transcodes only when the connection is too slow or the device cannot play the file.

WHAT MAKES IT DIFFERENT

- Apple's own player, with AirPlay and Picture in Picture
- Dolby Atmos and lossless surround at original quality, on supported tracks
- Quality that adapts to your connection while you watch
- Downloads on iPhone, iPad and Mac, at original quality or a smaller size
- Disc subtitles (PGS, VobSub, DVB, XSUB) decoded on the device
- Live TV with a guide, channel groups, favorites and recordings

WHAT YOU GET

- Movies, shows, music, audiobooks, photos, books and comics
- Search across your library and Live TV
- Continue Watching in sync with your server, and Up Next between episodes
- Top Shelf on Apple TV with Continue Watching and your recent channels
- Skip Intro and Skip Credits on Apple TV, when your server has the markers
- Audio tracks and subtitles you can switch while watching
- SyncPlay: watch together with others on your server
- Several servers and users, with no password to retype
- Filters, favorites and shuffle
- Themes you pick or make yourself

SET UP IN SECONDS

- Scan Network finds Jellyfin servers on your network
- Quick Connect signs you in from another Jellyfin app
- Or type just an IP

QUALITY

Auto measures your connection and starts at the best quality it can carry. Or set a limit from 480p to 4K. Server transcoding can be limited or turned off.

PRIVACY

No analytics, no tracking, no ads, no account with us. Your credentials stay in the device Keychain. Your library streams straight from your server to your device.

Tomo TV ships no media, channels, playlists or guides. It plays what your Jellyfin server and the sources you add provide, and you are responsible for having the right to access them.

Tomo TV is a free, open-source, independent client for Jellyfin and is not affiliated with or endorsed by the Jellyfin project. Jellyfin is a trademark of its respective owner.
```

### What's New (2.2.13), macOS (536 / 4000)

```text
- Live TV: set how many streams your provider allows at once, or let Tomo learn it
- Channels from a provider that allows one stream open reliably when you change channels
- A live channel that drops comes back on its own
- New items on your server show up on Home and in folders the next time you open them
- Channel previews fill in faster, and channel cards show the whole picture
- On the Channels screen, a red strip under each card shows how new its picture is
- A channel's info shows its latest picture, with the preview playing
```

### What's New (2.2.13), iOS (536 / 4000)

```text
- Live TV: set how many streams your provider allows at once, or let Tomo learn it
- Channels from a provider that allows one stream open reliably when you change channels
- A live channel that drops comes back on its own
- New items on your server show up on Home and in folders the next time you open them
- Channel previews fill in faster, and channel cards show the whole picture
- On the Channels screen, a red strip under each card shows how new its picture is
- A channel's info shows its latest picture, with the preview playing
```

### What's New (2.2.13), tvOS (544 / 4000)

```text
- Live TV: set how many streams your provider allows at once, or let Tomo learn it
- Channels from a provider that allows one stream open reliably when you change channels
- A live channel that drops comes back on its own
- New items on your server show up on Home and in folders the next time you open them
- Channel previews fill in faster, and channel cards show the whole picture
- On the Channels screen, a red strip under each card shows how new its picture is
- Top Shelf shows posters made from the video when your server has no artwork
```

### What's New (2.2.12), macOS (546 / 4000)

```text
- Lyrics follow the song in the music player; pick a line to jump to it
- Missing lyrics are found on lrclib.net and saved to your server when it allows
- On supported devices, Tomo listens to a song to time its lyrics word by word, or to write them when none exist
- The subtitles menu shows On while your saved subtitle language is playing
- Subtitles in your saved language no longer go missing when you resume a video
- Dolby Atmos now plays from Dolby Digital Plus 7.1 tracks, not only 5.1
- TV guide downloads pause while you watch or listen, and finish afterward
- Large TV guides load only the channels you have
```

### What's New (2.2.12), iOS (546 / 4000)

```text
- Lyrics follow the song in the music player; pick a line to jump to it
- Missing lyrics are found on lrclib.net and saved to your server when it allows
- On supported devices, Tomo listens to a song to time its lyrics word by word, or to write them when none exist
- The subtitles menu shows On while your saved subtitle language is playing
- Subtitles in your saved language no longer go missing when you resume a video
- Dolby Atmos now plays from Dolby Digital Plus 7.1 tracks, not only 5.1
- TV guide downloads pause while you watch or listen, and finish afterward
- Large TV guides load only the channels you have
```

### What's New (2.2.12), tvOS (701 / 4000)

```text
- Lyrics follow the song in the music player; pick a line to jump to it
- Missing lyrics are found on lrclib.net and saved to your server when it allows
- On supported devices, Tomo listens to a song to time its lyrics word by word, or to write them when none exist
- The player shows a show's name with its season and episode, a movie's year, and a song's artist and album
- The player's info shows the rating and genre
- The subtitles menu shows On while your saved subtitle language is playing
- Subtitles in your saved language no longer go missing when you resume a video
- Dolby Atmos now plays from Dolby Digital Plus 7.1 tracks, not only 5.1
- TV guide downloads pause while you watch or listen, and finish afterward
- Large TV guides load only the channels you have
```

### What's New (2.2.11), macOS (73 / 4000)

```text
- Tomo TV is now available on Mac with Apple Silicon and Intel processors
```

### What's New (2.2.11), iOS (385 / 4000)

```text
- Add a channel to any group from its info panel
- Multi-episode files show the full range, like S01E01-E02
- Live channels that played with flickering lines look right
- Your theme colors the background; pick artwork or a plain backdrop
- Search shows Live TV matches first
- Channel cards show LIVE only while their picture is fresh
- Original files download in several parts at once
```

### What's New (2.2.11), tvOS (448 / 4000)

```text
- Add a channel to any group from its info panel
- Multi-episode files show the full range, like S01E01-E02
- Live channels that played with flickering lines look right
- Your theme colors the background; pick artwork or a plain backdrop
- Search shows Live TV matches first
- Channel cards show LIVE only while their picture is fresh
- Swiping left in the Live TV guide always reaches the channels
- Back from a program, the guide keeps your place
```

### What's New (2.2.10), iOS (1705 / 4000)

```text
- Choose when your server transcodes: when needed, only for files this device can't play, or off. Settings also shows what your server allows
- Pick a theme in Settings > Appearance, or make your own and name it. Saved themes show on your other devices signed in to the same Jellyfin account
- Live TV search finds programmes through tomorrow by name, episode title or description, in your XMLTV guides too
- Pick a day in the Live TV guide from the calendar, up to two weeks ahead
- Record programmes from your XMLTV guides from their info panel
- Programmes being recorded show REC in Live TV search
- Scrubbing a video shows the picture as you drag
- Choose a size for each download: the original, or a smaller copy at 1080p, 720p or 480p that your server converts, in your audio language with your subtitle files (a 2.2.10 line; since 2.2.12 a smaller copy keeps subtitle files beside the movie, not tracks inside it)
- Downloads shows how fast files are coming down
- Hold Resume to play from the beginning
- Swipe an info panel left or right to the item beside it, like the next episode, even across seasons
- The Channels screen's search is a button in the navigation bar that opens Search
- With subtitles set to a language, its full track loads instead of a forced-only track
- MP4 files that keep their index at the end play again
- Downloads your server converts play their subtitles (a 2.2.10 line; since 2.2.12 that is subtitle files beside the movie, never a track inside it)
- Downloaded originals keep every audio track
- With server transcoding limited, a slow connection waits for the file instead of stopping with an error
- The loading spinner stays until the video is actually playing
- Starting Picture in Picture takes you back to where you started playing, and a queue moves on to its next item inside the window
- The error screen shows an error code to quote when you report a problem
```

### What's New (2.2.10), tvOS (1319 / 4000)

```text
- Choose when your server transcodes: when needed, only for files this device can't play, or off. Settings also shows what your server allows
- Pick a theme in Settings > Appearance, or make your own and name it. Saved themes show on your other devices signed in to the same Jellyfin account
- Live TV search finds programmes through tomorrow by name, episode title or description, in your XMLTV guides too
- A day strip above the channels opens the Live TV guide on any day up to two weeks ahead
- Record programmes from your XMLTV guides from their info panel
- Programmes being recorded show REC in Live TV search
- Scrubbing a video shows a preview of each scene above the timeline
- Hold Resume to play from the beginning
- With automatic subtitles on, the subtitle track Apple TV turns on loads
- With subtitles set to a language, its full track loads instead of a forced-only track
- MP4 files that keep their index at the end play again
- With server transcoding limited, a slow connection waits for the file instead of stopping with an error
- The loading spinner stays until the video is actually playing
- Starting Picture in Picture takes you back to where you started playing, and a queue moves on to its next item inside the window
- The error screen shows an error code to quote when you report a problem
```

### What's New (2.2.9), iOS (535 / 4000)

```text
- 4K remuxes play at full quality on a fast network instead of dropping to a lower one
- Filter the Live TV guide by favorites, your own groups, playlist groups and categories
- Add XMLTV guides for channels with no listings, and see which channels each one matched
- Search finds Live TV channels and programmes
- Channel cards show live frames, and offline channels can be hidden
- Record, favorite and group a channel from its info panel
- Admins can delete items from the server
- Settings shows the real speed of a fast connection
```

### What's New (2.2.9), tvOS (781 / 4000)

```text
- 4K remuxes start sooner, play at full quality on a fast network, and no longer close the app mid-movie
- Live TV has its own tab
- Record what is on, and add to favorites, from the playback controls
- Filter the Live TV guide by favorites, your own groups, playlist groups and categories
- Add XMLTV guides for channels with no listings, and see which channels each one matched
- Search finds Live TV channels and programmes
- Channel cards show live frames, and offline channels can be hidden
- Record, favorite and group a channel from its info panel
- Admins can delete items from the server
- Settings shows the real speed of your connection, and measures it again when you select it
- A live channel that stops no longer sends the app to the background from its error screen
```

### What's New (2.2.8), iOS (332 / 4000)

```text
- Audio and subtitle choices are saved to your Jellyfin account, so every device uses them
- Live TV on iPhone: drag the new glass knob to resize the channel column
- A refreshed app icon
- Audio and subtitle picks no longer reset when you return to the app
- Subtitles no longer turn off when a file labels its language differently
```

### What's New (2.2.8), tvOS (235 / 4000)

```text
- Audio and subtitle choices are saved to your Jellyfin account, so every device uses them
- Audio and subtitle picks no longer reset when you return to the app
- Subtitles no longer turn off when a file labels its language differently
```

### What's New (2.2.7), iOS (961 / 4000)

```text
- Playback follows your connection: original quality when it is fast, smaller streams when it is slow, and back up as it recovers
- Live TV guide: resize the channel column or snap it to logos, and empty slots say when a channel has no listings
- Live TV Channels: every channel on one wall, each card showing a live preview
- Live TV favorites: press and hold a channel to favorite it, then show only favorites, sort by number or name, or pause the previews
- Recordings gets Filters, and Show in Folder opens a recording there
- Bigger home cards with cleaner 3:2 artwork, and posters made from the video lose their black bars
- 8K videos your device cannot play directly stream from the server without stalling
- The playing track's card shows the level bars
- A video that keeps failing shows its error instead of retrying forever
- Fixed audio-track selection for videos with separate subtitle files, and a book that won't render no longer hangs the reader
```

### What's New (2.2.7), tvOS (968 / 4000)

```text
- Playback follows your connection: original quality when it is fast, smaller streams when it is slow, and back up as it recovers
- Live TV Channels: every channel on one wall, each card showing a live preview
- Live TV favorites: press and hold a channel to favorite it, then show only favorites, sort by number or name, or pause the previews
- Recordings gets Filters, and Show in Folder opens a recording there
- Folder browsing covers the tab bar, with a Home button that returns in one press, and a folder's background takes its colour from its artwork
- Bigger home cards with cleaner 3:2 artwork and a third row in view, and posters made from the video lose their black bars
- 8K videos your Apple TV cannot play directly stream from the server without stalling
- A video that keeps failing shows its error instead of retrying forever
- Fixed audio-track selection for videos with separate subtitle files, and a book that won't render no longer hangs the reader
```

### What's New (2.2.6), iOS (706 / 4000)

```text
- Live TV: a guide by time and channel, recordings and the schedule, with channels playing through the device rather than the server
- Books and comics from your library open in a reader: PDF, EPUB, MOBI, AZW, CBZ and CBR
- German, French and Spanish, following your device's language
- Saved sign-ins sit under the server list as avatars, and one tap reconnects
- Scan Network lists every Jellyfin server on a host and sweeps the common second-instance ports
- Films with subtitles start sooner: your device reads the subtitles itself, where the server used to spend several seconds preparing them before anything played
- ASS and SSA subtitle tracks are read on the device too and arrive with the picture
```

### What's New (2.2.6), tvOS (779 / 4000)

```text
- Live TV: a guide by time and channel, recordings and the schedule, with channels playing through the Apple TV rather than the server, and the remote's channel-skip gesture to flip between them
- Books and comics from your library open in a reader: PDF, EPUB, MOBI, AZW, CBZ and CBR
- German, French and Spanish, following your Apple TV's language
- Saved sign-ins stand beside the server list as avatars, and one click reconnects
- Scan Network lists every Jellyfin server on a host and sweeps the common second-instance ports
- Films with subtitles start sooner: your Apple TV reads the subtitles itself, where the server used to spend several seconds preparing them before anything played
- ASS and SSA subtitle tracks are read on the Apple TV too and arrive with the picture
```

### What's New (2.2.5), iOS (705 / 4000)

```text
- SyncPlay: watch together with everyone on your Jellyfin server, in sync
- 10-bit HEVC films play again on devices without an HEVC decoder, converted on the device or by the server instead of failing to start
- A film taller than your device's decoder can handle is converted rather than left to stutter
- Opening a large file no longer holds the app until its playlists arrive
- Posters taken from a file skip fades and black frames and keep the right colours
- HDR films now play when the server converts them
- Large films on a slow connection no longer fall back to server conversion
- Diagnostics is a structured document with the device, the OS and what it decodes, ready to paste into a bug report
```

### What's New (2.2.5), tvOS (680 / 4000)

```text
- SyncPlay: watch together with everyone on your Jellyfin server, in sync
- Apple TV HD plays 10-bit HEVC films again, converted on the device or by the server instead of failing to start
- A film taller than the Apple TV's decoder can handle is converted rather than left to stutter
- Opening a large file no longer holds the app until its playlists arrive
- Posters taken from a file skip fades and black frames and keep the right colours
- HDR films now play when the server converts them
- Large films on a slow connection no longer fall back to server conversion
- Diagnostics is a structured document with the device, the OS and what it decodes, ready to send to your iPhone
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

## The listing as it stands

**Promotional text is hand-written in English and does not change per release.**
Apple opens every new version with the field empty; `npm run meta:upload` re-sends it.

The three translations come from the local model like the release notes do, but
only on request: `npm run notes -- --redo promo --write` after the English block
changes. A plain run never rewrites a block the document already holds, so an
archive cannot replace copy a reader has already passed over.

## Localized paste blocks

Same rule as the English blocks above: these win. Product nouns follow
Jellyfin's own translations, platform nouns follow Apple's localized pages.
Keywords are capped in bytes, not characters, so an accent costs two.
Each language keeps one register: German du, French vous, Spanish tú (never
vosotros, since one block serves es-ES and es-MX).

### German (de-DE)

#### App Name (24 / 30 chars)

```text
Tomo TV, Jellyfin-Client
```

#### Subtitle (29 / 30 chars)

```text
Filme, Live-TV, Musik, Bücher
```

#### Promotional Text (167 / 170 chars)

```text
Kostenlos, quelloffen, ohne Werbung und ohne Konto. Spielt Live-TV, 4K, Dolby Vision und Dolby Atmos in Apples Player und findet deinen Jellyfin-Server ohne Eintippen.
```

#### Keywords (97 / 100 bytes)

```text
player,download,server,nas,atmos,dolby,surround,hevc,mkv,untertitel,heimkino,hörbuch,comics,epub
```

#### Description (2461 / 4000 chars)

```text
Tomo TV spielt deine Jellyfin-Bibliothek auf Apple TV, iPhone, iPad und Mac. Dein Gerät spielt die Datei selbst ab: H.264 und HEVC in jedem Container, auch in 4K, HDR10, HLG und Dolby Vision. Die meisten anderen Formate wandelt das Gerät um. Dein Server wandelt nur um, wenn die Verbindung zu langsam ist oder das Gerät die Datei nicht abspielen kann.

WAS ANDERS IST

- Apples eigener Player, mit AirPlay und Bild-in-Bild
- Dolby Atmos und verlustfreier Surround-Ton in Originalqualität, bei unterstützten Spuren
- Qualität, die sich beim Schauen an deine Verbindung anpasst
- Downloads auf iPhone, iPad und Mac, in Originalqualität oder kleiner
- Disc-Untertitel (PGS, VobSub, DVB, XSUB), auf dem Gerät dekodiert
- Live-TV mit Fernsehprogramm, Kanalgruppen, Favoriten und Aufnahmen

WAS DU BEKOMMST

- Filme, Serien, Musik, Hörbücher, Fotos, Bücher und Comics
- Suche in deiner Bibliothek und im Live-TV
- Weiterschauen, synchron mit deinem Server, und Als Nächstes zwischen den Folgen
- Top Shelf auf dem Apple TV mit Weiterschauen und deinen letzten Kanälen
- Intro und Abspann überspringen auf dem Apple TV, wenn dein Server die Marker hat
- Tonspuren und Untertitel, die du beim Schauen wechseln kannst
- SyncPlay: gemeinsam schauen mit anderen auf deinem Server
- Mehrere Server und Benutzer, ohne das Passwort erneut einzugeben
- Filter, Favoriten und Zufallswiedergabe
- Themen, die du auswählst oder selbst erstellst

IN SEKUNDEN EINGERICHTET

- „Netzwerk scannen“ findet Jellyfin-Server in deinem Netzwerk
- Quick Connect meldet dich über eine andere Jellyfin-App an
- Oder tippe nur eine IP ein

QUALITÄT

Automatisch misst deine Verbindung und startet in der besten Qualität, die sie schafft. Oder setze eine Grenze von 480p bis 4K. Die Umwandlung durch den Server lässt sich einschränken oder ausschalten.

DATENSCHUTZ

Keine Analyse, kein Tracking, keine Werbung, kein Konto bei uns. Deine Zugangsdaten bleiben im Schlüsselbund des Geräts. Deine Bibliothek läuft direkt von deinem Server auf dein Gerät.

Tomo TV enthält keine Medien, Kanäle, Wiedergabelisten oder Fernsehprogramme. Die App spielt ab, was dein Jellyfin-Server und die Quellen liefern, die du hinzufügst. Für das Recht, darauf zuzugreifen, bist du verantwortlich.

Tomo TV ist ein kostenloser, quelloffener und unabhängiger Client für Jellyfin und steht in keiner Verbindung zum Jellyfin-Projekt und wird von ihm nicht unterstützt. Jellyfin ist eine Marke des jeweiligen Inhabers.
```

#### What's New (2.2.13), macOS (584 / 4000)

```text
- Live-TV: lege fest, wie viele Streams dein Anbieter gleichzeitig erlaubt, oder lass Tomo es lernen
- Kanäle eines Anbieters, der nur einen Stream erlaubt, öffnen beim Umschalten zuverlässig
- Bricht ein Live-Kanal ab, kommt er von selbst zurück
- Neues auf deinem Server erscheint auf Start und in Ordnern, sobald du sie wieder öffnest
- Kanalvorschauen füllen sich schneller, und Kanalkarten zeigen das ganze Bild
- Auf dem Bildschirm Kanäle zeigt ein roter Streifen unter jeder Karte, wie neu ihr Bild ist
- Die Infos eines Kanals zeigen sein neuestes Bild, mit laufender Vorschau
```

#### What's New (2.2.13), iOS (584 / 4000 chars)

```text
- Live-TV: lege fest, wie viele Streams dein Anbieter gleichzeitig erlaubt, oder lass Tomo es lernen
- Kanäle eines Anbieters, der nur einen Stream erlaubt, öffnen beim Umschalten zuverlässig
- Bricht ein Live-Kanal ab, kommt er von selbst zurück
- Neues auf deinem Server erscheint auf Start und in Ordnern, sobald du sie wieder öffnest
- Kanalvorschauen füllen sich schneller, und Kanalkarten zeigen das ganze Bild
- Auf dem Bildschirm Kanäle zeigt ein roter Streifen unter jeder Karte, wie neu ihr Bild ist
- Die Infos eines Kanals zeigen sein neuestes Bild, mit laufender Vorschau
```

#### What's New (2.2.13), tvOS (592 / 4000 chars)

```text
- Live-TV: lege fest, wie viele Streams dein Anbieter gleichzeitig erlaubt, oder lass Tomo es lernen
- Kanäle eines Anbieters, der nur einen Stream erlaubt, öffnen beim Umschalten zuverlässig
- Bricht ein Live-Kanal ab, kommt er von selbst zurück
- Neues auf deinem Server erscheint auf Start und in Ordnern, sobald du sie wieder öffnest
- Kanalvorschauen füllen sich schneller, und Kanalkarten zeigen das ganze Bild
- Auf dem Bildschirm Kanäle zeigt ein roter Streifen unter jeder Karte, wie neu ihr Bild ist
- Top Shelf zeigt aus dem Video erzeugte Poster, wenn dein Server kein Artwork hat
```

#### What's New (2.2.12), macOS (668 / 4000)

```text
- Liedtexte laufen im Musikplayer mit dem Song mit; wähle eine Zeile, um dorthin zu springen
- Fehlende Liedtexte werden auf lrclib.net gesucht und auf deinem Server gespeichert, wenn er es erlaubt
- Auf unterstützten Geräten hört Tomo einen Song an, um den Liedtext Wort für Wort zu takten oder ihn zu schreiben, wenn es keinen gibt
- Das Untertitelmenü zeigt Untertitel als eingeschaltet, solange deine gespeicherte Untertitelsprache läuft
- Untertitel in deiner gespeicherten Sprache fehlen nicht mehr, wenn du ein Video fortsetzt
- Dolby Atmos spielt jetzt auch von Dolby Digital Plus 7.1-Spuren, nicht nur von 5.1
- Guide-Downloads pausieren, während du schaust oder hörst, und laufen danach zu Ende
- Große Guides laden nur die Kanäle, die du hast
```

#### What's New (2.2.12), iOS (668 / 4000 chars)

```text
- Liedtexte laufen im Musikplayer mit dem Song mit; wähle eine Zeile, um dorthin zu springen
- Fehlende Liedtexte werden auf lrclib.net gesucht und auf deinem Server gespeichert, wenn er es erlaubt
- Auf unterstützten Geräten hört Tomo einen Song an, um den Liedtext Wort für Wort zu takten oder ihn zu schreiben, wenn es keinen gibt
- Das Untertitelmenü zeigt Untertitel als eingeschaltet, solange deine gespeicherte Untertitelsprache läuft
- Untertitel in deiner gespeicherten Sprache fehlen nicht mehr, wenn du ein Video fortsetzt
- Dolby Atmos spielt jetzt auch von Dolby Digital Plus 7.1-Spuren, nicht nur von 5.1
- Guide-Downloads pausieren, während du schaust oder hörst, und laufen danach zu Ende
- Große Guides laden nur die Kanäle, die du hast
```

#### What's New (2.2.12), tvOS (843 / 4000 chars)

```text
- Liedtexte laufen im Musikplayer mit dem Song mit; wähle eine Zeile, um dorthin zu springen
- Fehlende Liedtexte werden auf lrclib.net gesucht und auf deinem Server gespeichert, wenn er es erlaubt
- Auf unterstützten Geräten hört Tomo einen Song an, um den Liedtext Wort für Wort zu takten oder ihn zu schreiben, wenn es keinen gibt
- Der Player zeigt den Namen einer Serie mit Staffel und Folge, das Jahr eines Films und Interpret und Album eines Songs
- Die Infos im Player zeigen Altersfreigabe und Genre
- Das Untertitelmenü zeigt Untertitel als eingeschaltet, solange deine gespeicherte Untertitelsprache läuft
- Untertitel in deiner gespeicherten Sprache fehlen nicht mehr, wenn du ein Video fortsetzt
- Dolby Atmos spielt jetzt auch von Dolby Digital Plus 7.1-Spuren, nicht nur von 5.1
- Guide-Downloads pausieren, während du schaust oder hörst, und laufen danach zu Ende
- Große Guides laden nur die Kanäle, die du hast
```

#### What's New (2.2.11), macOS (78 / 4000)

```text
- Tomo TV ist jetzt auf Macs mit Apple Silicon und Intel-Prozessoren verfügbar
```

#### What's New (2.2.11), iOS (454 / 4000 chars)

```text
- Füge einen Kanal über seinen Info-Bereich jeder Gruppe hinzu
- Dateien mit mehreren Folgen zeigen den ganzen Bereich, etwa S01E01-E02
- Live-Kanäle, die mit flimmernden Streifen liefen, sehen richtig aus
- Dein Thema färbt den Hintergrund; wähle Artwork oder einen schlichten Hintergrund
- Die Suche zeigt Live-TV-Treffer zuerst
- Kanalkarten zeigen LIVE nur, solange ihr Bild frisch ist
- Originaldateien werden in mehreren Teilen gleichzeitig geladen
```

#### What's New (2.2.11), tvOS (511 / 4000 chars)

```text
- Füge einen Kanal über seinen Info-Bereich jeder Gruppe hinzu
- Dateien mit mehreren Folgen zeigen den ganzen Bereich, etwa S01E01-E02
- Live-Kanäle, die mit flimmernden Streifen liefen, sehen richtig aus
- Dein Thema färbt den Hintergrund; wähle Artwork oder einen schlichten Hintergrund
- Die Suche zeigt Live-TV-Treffer zuerst
- Kanalkarten zeigen LIVE nur, solange ihr Bild frisch ist
- Nach links gelangst du im Live-TV-Guide immer zu den Kanälen
- Zurück von einer Sendung behält der Guide deine Position
```

#### What's New (2.2.10), iOS (1962 / 4000 chars)

```text
- Lege fest, wann dein Server umwandelt: „Bei Bedarf“, „Nur für nicht unterstützte Dateien“ oder „Aus“. Die Einstellungen zeigen auch, was dein Server erlaubt
- Wähle unter Einstellungen > Darstellung ein Thema oder erstelle und benenne dein eigenes. Gespeicherte Themen erscheinen auf deinen anderen Geräten mit demselben Jellyfin-Konto
- Die Live-TV-Suche findet Sendungen bis morgen nach Titel, Episodentitel oder Beschreibung, auch in deinen XMLTV-Guides
- Wähle im Live-TV-Guide einen Tag aus dem Kalender, bis zu zwei Wochen im Voraus
- Nimm Sendungen aus deinen XMLTV-Guides direkt im Info-Bereich auf
- Sendungen, die gerade aufgenommen werden, zeigen in der Live-TV-Suche REC
- Beim Spulen folgt das Bild deinem Finger
- Wähle für jeden Download eine Größe: das Original oder eine kleinere Kopie in 1080p, 720p oder 480p, die dein Server umwandelt, in deiner Audiosprache und mit deinen Untertiteln
- Downloads zeigt, wie schnell gerade geladen wird
- Halte „Fortsetzen“ gedrückt, um von vorne abzuspielen
- Wische einen Info-Bereich nach links oder rechts zum benachbarten Titel, etwa zur nächsten Folge, auch über Staffeln hinweg
- Die Suche in „Kanäle“ ist eine Schaltfläche in der Navigationsleiste, die „Suche“ öffnet
- Ist eine Untertitelsprache eingestellt, wird ihre vollständige Spur geladen statt einer Spur nur mit erzwungenen Untertiteln
- MP4-Dateien mit dem Index am Dateiende lassen sich wieder abspielen
- Downloads, die dein Server umwandelt, zeigen ihre Untertitel
- Heruntergeladene Originale behalten jede Tonspur
- Ist die Server-Umwandlung eingeschränkt, wartet eine langsame Verbindung auf die Datei, statt mit einem Fehler abzubrechen
- Der Ladekreis bleibt, bis das Video wirklich läuft
- Bild-in-Bild bringt dich zurück dorthin, wo du die Wiedergabe gestartet hast, und eine Warteschlange geht im Fenster zum nächsten Titel weiter
- Der Fehlerbildschirm zeigt einen Fehlercode, den du nennen kannst, wenn du ein Problem meldest
```

#### What's New (2.2.10), tvOS (1550 / 4000 chars)

```text
- Lege fest, wann dein Server umwandelt: „Bei Bedarf“, „Nur für nicht unterstützte Dateien“ oder „Aus“. Die Einstellungen zeigen auch, was dein Server erlaubt
- Wähle unter Einstellungen > Darstellung ein Thema oder erstelle und benenne dein eigenes. Gespeicherte Themen erscheinen auf deinen anderen Geräten mit demselben Jellyfin-Konto
- Die Live-TV-Suche findet Sendungen bis morgen nach Titel, Episodentitel oder Beschreibung, auch in deinen XMLTV-Guides
- Eine Tagesleiste über den Kanälen öffnet den Live-TV-Guide an jedem Tag bis zu zwei Wochen im Voraus
- Nimm Sendungen aus deinen XMLTV-Guides direkt im Info-Bereich auf
- Sendungen, die gerade aufgenommen werden, zeigen in der Live-TV-Suche REC
- Beim Spulen erscheint über der Zeitleiste eine Vorschau der jeweiligen Szene
- Halte „Fortsetzen“ gedrückt, um von vorne abzuspielen
- Sind automatische Untertitel an, wird die Untertitelspur geladen, die Apple TV einschaltet
- Ist eine Untertitelsprache eingestellt, wird ihre vollständige Spur geladen statt einer Spur nur mit erzwungenen Untertiteln
- MP4-Dateien mit dem Index am Dateiende lassen sich wieder abspielen
- Ist die Server-Umwandlung eingeschränkt, wartet eine langsame Verbindung auf die Datei, statt mit einem Fehler abzubrechen
- Der Ladekreis bleibt, bis das Video wirklich läuft
- Bild-in-Bild bringt dich zurück dorthin, wo du die Wiedergabe gestartet hast, und eine Warteschlange geht im Fenster zum nächsten Titel weiter
- Der Fehlerbildschirm zeigt einen Fehlercode, den du nennen kannst, wenn du ein Problem meldest
```

#### What's New (2.2.9), iOS (651 / 4000 chars)

```text
- 4K-Remuxe laufen bei schnellem Netzwerk in voller Qualität, statt auf eine niedrigere zu wechseln
- Filtere den Live-TV-Guide nach Favoriten, deinen eigenen Gruppen, Wiedergabelistengruppen und Kategorien
- Füge XMLTV-Guides für Kanäle ohne Programm hinzu und sieh, welche Kanäle jeder zugeordnet hat
- Die Suche findet Live-TV-Kanäle und -Programme
- Kanalkarten zeigen Live-Bilder, und Offline-Kanäle lassen sich ausblenden
- Nimm einen Kanal auf, markiere ihn als Favoriten und ordne ihn Gruppen zu, direkt im Info-Bereich
- Admins können Elemente vom Server löschen
- Die Einstellungen zeigen die echte Geschwindigkeit einer schnellen Verbindung
```

#### What's New (2.2.9), tvOS (950 / 4000 chars)

```text
- 4K-Remuxe starten schneller, laufen bei schnellem Netzwerk in voller Qualität und schließen die App nicht mehr mitten im Film
- Live-TV hat eine eigene Registerkarte
- Nimm auf, was gerade läuft, und füge es über die Wiedergabesteuerung zu den Favoriten hinzu
- Filtere den Live-TV-Guide nach Favoriten, deinen eigenen Gruppen, Wiedergabelistengruppen und Kategorien
- Füge XMLTV-Guides für Kanäle ohne Programm hinzu und sieh, welche Kanäle jeder zugeordnet hat
- Die Suche findet Live-TV-Kanäle und -Programme
- Kanalkarten zeigen Live-Bilder, und Offline-Kanäle lassen sich ausblenden
- Nimm einen Kanal auf, markiere ihn als Favoriten und ordne ihn Gruppen zu, direkt im Info-Bereich
- Admins können Elemente vom Server löschen
- Die Einstellungen zeigen die echte Geschwindigkeit deiner Verbindung und messen sie neu, wenn du sie auswählst
- Ein Live-Kanal, der stoppt, schickt die App von seinem Fehlerbildschirm nicht mehr in den Hintergrund
```

#### What's New (2.2.8), iOS (383 / 4000 chars)

```text
- Audio- und Untertitelwahl werden in deinem Jellyfin-Konto gespeichert und gelten auf jedem Gerät
- Live-TV auf dem iPhone: Zieh den neuen Glasregler, um die Senderspalte anzupassen
- Ein überarbeitetes App-Symbol
- Gewählte Tonspur und Untertitel bleiben erhalten, wenn du zur App zurückkehrst
- Untertitel schalten sich nicht mehr ab, wenn eine Datei die Sprache anders bezeichnet
```

#### What's New (2.2.8), tvOS (267 / 4000 chars)

```text
- Audio- und Untertitelwahl werden in deinem Jellyfin-Konto gespeichert und gelten auf jedem Gerät
- Gewählte Tonspur und Untertitel bleiben erhalten, wenn du zur App zurückkehrst
- Untertitel schalten sich nicht mehr ab, wenn eine Datei die Sprache anders bezeichnet
```

#### What's New (2.2.7), iOS (1155 / 4000 chars)

```text
- Die Wiedergabe folgt deiner Verbindung: Originalqualität bei schneller Verbindung, kleinere Streams bei langsamer, und wieder Originalqualität, sobald sie sich erholt
- Fernsehprogramm im Live-TV: Senderspalte anpassen oder auf Logos einklappen, und leere Felder zeigen an, wenn ein Sender keine Programmdaten hat
- Live-TV-Kanäle: alle Kanäle auf einer Seite, jede Karte mit einer Live-Vorschau
- Live-TV-Favoriten: einen Kanal gedrückt halten, um ihn zu favorisieren, dann nur Favoriten anzeigen, nach Nummer oder Name sortieren oder die Vorschauen pausieren
- Aufnahmen bekommen Filter, und „Im Verzeichnis zeigen“ öffnet eine Aufnahme dort
- Größere Startseiten-Karten mit sauberem 3:2-Bild, und aus dem Video erzeugte Poster verlieren ihre schwarzen Balken
- 8K-Videos, die das Gerät nicht direkt abspielt, laufen ohne Stocken über den Server
- Die Karte des laufenden Titels zeigt die Pegelbalken
- Ein Video, das ständig fehlschlägt, zeigt seinen Fehler, statt es ewig neu zu versuchen
- Die Tonspurauswahl bei Videos mit separaten Untertiteldateien wurde korrigiert, und ein Buch, das sich nicht darstellen lässt, blockiert den Reader nicht mehr
```

#### What's New (2.2.7), tvOS (1154 / 4000 chars)

```text
- Die Wiedergabe folgt deiner Verbindung: Originalqualität bei schneller Verbindung, kleinere Streams bei langsamer, und wieder Originalqualität, sobald sie sich erholt
- Live-TV-Kanäle: alle Kanäle auf einer Seite, jede Karte mit einer Live-Vorschau
- Live-TV-Favoriten: einen Kanal gedrückt halten, um ihn zu favorisieren, dann nur Favoriten anzeigen, nach Nummer oder Name sortieren oder die Vorschauen pausieren
- Aufnahmen bekommen Filter, und „Im Verzeichnis zeigen“ öffnet eine Aufnahme dort
- Verzeichnisse werden ohne Tableiste durchsucht, mit einer Start-Taste zurück in einem Schritt, und der Verzeichnishintergrund nimmt die Farbe seines Artworks an
- Größere Startseiten-Karten mit sauberem 3:2-Bild und einer dritten sichtbaren Reihe, und aus dem Video erzeugte Poster verlieren ihre schwarzen Balken
- 8K-Videos, die das Apple TV nicht direkt abspielt, laufen ohne Stocken über den Server
- Ein Video, das ständig fehlschlägt, zeigt seinen Fehler, statt es ewig neu zu versuchen
- Die Tonspurauswahl bei Videos mit separaten Untertiteldateien wurde korrigiert, und ein Buch, das sich nicht darstellen lässt, blockiert den Reader nicht mehr
```

#### What's New (2.2.6), iOS (872 / 4000 chars)

```text
- Live-TV: Fernsehprogramm nach Zeit und Kanal, Aufnahmen und geplante Aufnahmen, mit Kanälen, die über das Gerät statt über den Server laufen
- Bücher und Comics aus deiner Bibliothek öffnen sich in einem Reader: PDF, EPUB, MOBI, AZW, CBZ und CBR
- Deutsch, Französisch und Spanisch, entsprechend der Sprache deines Geräts
- Gespeicherte Anmeldungen stehen unter der Serverliste als Avatare, und ein Tippen stellt die Verbindung wieder her
- Netzwerk scannen listet jeden Jellyfin-Server auf einem Host auf und durchsucht die gängigen Ports für die zweite Instanz
- Filme mit Untertiteln starten schneller: dein Gerät liest die Untertitel selbst, während der Server früher mehrere Sekunden damit verbrachte, sie vorab vorzubereiten, bevor das Abspielen begann
- ASS- und SSA-Untertitelspuren werden ebenfalls auf dem Gerät gelesen und sind synchron mit dem Bild verfügbar
```

#### What's New (2.2.6), tvOS (958 / 4000 chars)

```text
- Live-TV: Fernsehprogramm nach Zeit und Kanal, Aufnahmen und geplante Aufnahmen, mit Kanälen, die über das Apple TV statt über den Server laufen, und der Kanalwechsel-Geste der Fernbedienung zum Umschalten zwischen ihnen
- Bücher und Comics aus deiner Bibliothek öffnen sich in einem Reader: PDF, EPUB, MOBI, AZW, CBZ und CBR
- Deutsch, Französisch und Spanisch, entsprechend der Sprache deines Apple TV
- Gespeicherte Anmeldungen stehen neben der Serverliste als Avatare, und ein Klick stellt die Verbindung wieder her
- Netzwerk scannen listet jeden Jellyfin-Server auf einem Host auf und durchsucht die gängigen Ports für die zweite Instanz
- Filme mit Untertiteln starten schneller: dein Apple TV liest die Untertitel selbst, während der Server früher mehrere Sekunden damit verbrachte, sie vorab vorzubereiten, bevor das Abspielen begann
- ASS- und SSA-Untertitelspuren werden ebenfalls auf dem Apple TV gelesen und sind synchron mit dem Bild verfügbar
```

#### What's New (2.2.5), iOS (789 / 4000 chars)

```text
- SyncPlay: gemeinsam schauen mit allen auf deinem Jellyfin-Server, synchron
- 10-Bit-HEVC-Filme laufen wieder auf Geräten ohne HEVC-Dekoder, umgewandelt auf dem Gerät oder vom Server, statt gar nicht zu starten
- Ein Film, der höher ist als der Dekoder deines Geräts verkraftet, wird umgewandelt statt zu ruckeln
- Eine große Datei zu öffnen hält die App nicht mehr auf, bis ihre Wiedergabelisten da sind
- Aus einer Datei entnommene Poster überspringen Blenden und schwarze Bilder und behalten die richtigen Farben
- HDR-Filme laufen jetzt auch, wenn der Server sie umwandelt
- Große Filme bei langsamer Verbindung fallen nicht mehr auf die Server-Umwandlung zurück
- Die Diagnose ist ein strukturiertes Dokument mit Gerät, System und dekodierbaren Formaten, fertig für den Fehlerbericht
```

#### What's New (2.2.5), tvOS (558 / 4000 chars)

```text
- SyncPlay: gemeinsam schauen mit allen auf deinem Jellyfin-Server, synchron
- Apple TV HD spielt wieder 10-Bit-HEVC-Filme, umgewandelt auf dem Gerät oder vom Server, statt gar nicht zu starten
- Ein Film, der höher ist als der Dekoder des Apple TV verkraftet, wird umgewandelt statt zu ruckeln
- Eine große Datei zu öffnen hält die App nicht mehr auf, bis ihre Wiedergabelisten da sind
- Aus einer Datei entnommene Poster überspringen Blenden und schwarze Bilder und behalten die richtigen Farben
- HDR-Filme laufen jetzt auch, wenn der Server sie umwandelt
```

#### What's New (2.2.1), iOS (1643 / 4000 chars)

```text
- Zoome ein Foto mit zwei Fingern, tippe doppelt, um auf die berührte Stelle zu zoomen oder wieder heraus, und teile es aus seinem Info-Bereich
- Wische nach links oder rechts zum nächsten Foto, ohne seitliche Tippflächen, die dem Wischen in die Quere kommen, und nach unten, um die Ansicht zu schließen
- Schließen und Diashow der Fotoansicht sind ein einziges Glas-Bedienelement, das beide aus sich heraus öffnet
- Fotos öffnen das Bild, das du wirklich gewählt hast, aus einem Info-Bereich oder aus den Reihen „Neu“, „Favoriten“ und „Suche“
- „Im Verzeichnis zeigen“ öffnet das Objekt sichtbar und ausgewählt, statt erst später dorthin zu scrollen
- Hardware-Tastatur am Mac: Leertaste und Zeilenschalter spielen ab und pausieren, die Pfeiltasten springen fünfzehn Sekunden, und ein Doppelklick auf ein Video füllt den Rahmen
- Das Cover im Musikplayer ist eine abgerundete Karte über einem Schleier aus sich selbst, in jedem Fenster frei von der Steuerleiste
- Die Sprungtasten des Mini-Players werden an den Enden der Warteschlange gedimmt, und ein Tippen auf Pause landet nicht mehr auf Weiter
- Diagnose, in den Einstellungen unter „Über Tomo TV“: was die Engine bei der letzten Wiedergabe getan hat, welchen Weg sie gewählt hat und warum sie eine Datei abgelehnt hat, die Streams, die dein Server beschrieben hat, jeder Fehler und die Version. Kopiere sie in einen Fehlerbericht. Nur die letzte Sitzung wird behalten, und sie verlässt das Gerät nie
- Die Qualitätsstufen sind Obergrenzen, „Bis zu 1080p“, mit einem Hinweis, wann eine Obergrenze greift: bei einer langsamen Verbindung oder bei einer Datei, die der Server umwandeln muss
```

#### What's New (2.2.1), tvOS (878 / 4000 chars)

```text
- Kapitel: Ein Film oder eine Episode mit Kapitelmarken listet sie im Info-Bereich des Players, und eine Auswahl springt dorthin (#71)
- Fotos öffnen das Bild, das du wirklich gewählt hast, aus einem Info-Bereich oder aus den Reihen „Neu“, „Favoriten“ und „Suche“
- „Im Verzeichnis zeigen“ öffnet das Objekt sichtbar und ausgewählt, statt erst später dorthin zu scrollen
- Diagnose, in den Einstellungen unter „Über Tomo TV“: was die Engine bei der letzten Wiedergabe getan hat, welchen Weg sie gewählt hat und warum sie eine Datei abgelehnt hat, die Streams, die dein Server beschrieben hat, jeder Fehler und die Version. Nur die letzte Sitzung wird behalten, und sie verlässt das Gerät nie
- Die Qualitätsstufen sind Obergrenzen, „Bis zu 1080p“, mit einem Hinweis, wann eine Obergrenze greift: bei einer langsamen Verbindung oder bei einer Datei, die der Server umwandeln muss
```

#### What's New (2.2.0), iOS (582 / 4000 chars)

```text
- Downloads: Behalte ein Objekt oder einen ganzen Ordner auf dem Gerät und spiel es ohne den Server ab; der Fortschritt offline wird danach synchronisiert
- Dolby Vision läuft als Dolby Vision, auch von Discs mit zwei Ebenen
- Ein Mini-Player hält die Musik am Laufen, während du stöberst, und Titel zeigen Disc und Track statt S1E1 (#68)
- Ordner öffnen sich in einer echten Navigationsleiste
- Drücke lange auf ein Suchergebnis für seinen Info-Bereich und spiel es mit deiner Position und einer Warteschlange ab
- Bessere Handhabung von Wiedergabelisten mit mehr als 500 Einträgen
```

#### What's New (2.2.0), tvOS (425 / 4000 chars)

```text
- Dolby Vision läuft als Dolby Vision, auch von Discs mit zwei Ebenen
- Musik spielt weiter, wenn du den Player verlässt, und Titel zeigen Disc und Track statt S1E1 (#68)
- Drücke lange auf ein Suchergebnis für seinen Info-Bereich und spiel es mit deiner Position und einer Warteschlange ab
- Mediathek-Kacheln sagen, was sie zählen: Episoden, Titel, Fotos
- Bessere Handhabung von Wiedergabelisten mit mehr als 500 Einträgen
```

### French (fr-FR)

#### App Name (24 / 30 chars)

```text
Tomo TV, client Jellyfin
```

#### Subtitle (30 / 30 chars)

```text
Ciné, TV live, musique, livres
```

#### Promotional Text (167 / 170 chars)

```text
Gratuit, open source, sans pub ni compte. Lit la TV en direct, la 4K, le Dolby Vision et le Dolby Atmos dans le lecteur d'Apple, et trouve seul votre serveur Jellyfin.
```

#### Keywords (85 / 100 bytes)

```text
lecteur,téléchargement,serveur,nas,atmos,dolby,hevc,mkv,sous-titres,cinéma,bd,epub
```

#### Description (2466 / 4000 chars)

```text
Tomo TV lit votre médiathèque Jellyfin sur Apple TV, iPhone, iPad et Mac. Votre appareil lit lui-même le fichier : H.264 et HEVC dans n'importe quel conteneur, 4K, HDR10, HLG et Dolby Vision compris. La plupart des autres formats sont convertis sur l'appareil. Votre serveur ne convertit que si la connexion est trop lente ou si l'appareil ne peut pas lire le fichier.

CE QUI CHANGE

- Le lecteur d'Apple, avec AirPlay et Image dans l'image
- Dolby Atmos et son surround sans perte en qualité d'origine, sur les pistes compatibles
- Une qualité qui s'adapte à votre connexion pendant la lecture
- Téléchargements sur iPhone, iPad et Mac, en qualité d'origine ou réduite
- Sous-titres de disque (PGS, VobSub, DVB, XSUB) décodés sur l'appareil
- TV en direct avec guide, groupes de chaînes, favoris et enregistrements

CE QUE VOUS AVEZ

- Films, séries, musique, livres audio, photos, livres et BD
- Recherche dans votre médiathèque et la TV en direct
- Continuer de regarder, synchronisé avec votre serveur, et À suivre entre les épisodes
- Top Shelf sur l'Apple TV avec Continuer de regarder et vos chaînes récentes
- Passer l'intro et le générique sur l'Apple TV, quand votre serveur a les marqueurs
- Pistes audio et sous-titres à changer en cours de lecture
- SyncPlay : regardez en même temps que d'autres sur votre serveur
- Plusieurs serveurs et utilisateurs, sans ressaisir de mot de passe
- Filtres, favoris et lecture aléatoire
- Thèmes à choisir ou à créer vous-même

CONFIGURÉ EN QUELQUES SECONDES

- « Analyser le réseau » trouve les serveurs Jellyfin de votre réseau
- Quick Connect vous connecte depuis une autre app Jellyfin
- Ou saisissez juste une IP

QUALITÉ

Auto mesure votre connexion et démarre à la meilleure qualité qu'elle permet. Ou fixez une limite de 480p à 4K. La conversion par le serveur peut être limitée ou désactivée.

CONFIDENTIALITÉ

Aucune analyse, aucun suivi, aucune publicité, aucun compte chez nous. Vos identifiants restent dans le trousseau de l'appareil. Votre médiathèque est diffusée directement de votre serveur vers votre appareil.

Tomo TV ne fournit aucun média, chaîne, liste de lecture ni guide. L'app lit ce que proposent votre serveur Jellyfin et les sources que vous ajoutez, et il vous revient d'avoir le droit d'y accéder.

Tomo TV est un client gratuit, open source et indépendant pour Jellyfin; il n'est ni affilié au projet Jellyfin ni approuvé par lui. Jellyfin est une marque de son détenteur respectif.
```

#### What's New (2.2.13), macOS (645 / 4000)

```text
- TV en direct : indiquez combien de flux votre fournisseur autorise à la fois, ou laissez Tomo l'apprendre
- Les chaînes d'un fournisseur qui n'autorise qu'un flux s'ouvrent sans échec quand vous changez de chaîne
- Une chaîne en direct qui se coupe revient d'elle-même
- Les nouveautés de votre serveur apparaissent dans Accueil et dans les dossiers dès que vous les rouvrez
- Les aperçus des chaînes se remplissent plus vite, et les cartes de chaîne montrent l'image entière
- Sur l'écran Chaînes, une bande rouge sous chaque carte indique si son image est récente
- Les infos d'une chaîne montrent sa dernière image, avec l'aperçu en lecture
```

#### What's New (2.2.13), iOS (645 / 4000 chars)

```text
- TV en direct : indiquez combien de flux votre fournisseur autorise à la fois, ou laissez Tomo l'apprendre
- Les chaînes d'un fournisseur qui n'autorise qu'un flux s'ouvrent sans échec quand vous changez de chaîne
- Une chaîne en direct qui se coupe revient d'elle-même
- Les nouveautés de votre serveur apparaissent dans Accueil et dans les dossiers dès que vous les rouvrez
- Les aperçus des chaînes se remplissent plus vite, et les cartes de chaîne montrent l'image entière
- Sur l'écran Chaînes, une bande rouge sous chaque carte indique si son image est récente
- Les infos d'une chaîne montrent sa dernière image, avec l'aperçu en lecture
```

#### What's New (2.2.13), tvOS (658 / 4000 chars)

```text
- TV en direct : indiquez combien de flux votre fournisseur autorise à la fois, ou laissez Tomo l'apprendre
- Les chaînes d'un fournisseur qui n'autorise qu'un flux s'ouvrent sans échec quand vous changez de chaîne
- Une chaîne en direct qui se coupe revient d'elle-même
- Les nouveautés de votre serveur apparaissent dans Accueil et dans les dossiers dès que vous les rouvrez
- Les aperçus des chaînes se remplissent plus vite, et les cartes de chaîne montrent l'image entière
- Sur l'écran Chaînes, une bande rouge sous chaque carte indique si son image est récente
- Top Shelf montre des affiches créées à partir de la vidéo quand votre serveur n'en a pas
```

#### What's New (2.2.12), macOS (698 / 4000)

```text
- Les paroles suivent la chanson dans le lecteur de musique; choisissez une ligne pour y aller
- Les paroles manquantes sont cherchées sur lrclib.net et enregistrées sur votre serveur s'il l'autorise
- Sur les appareils compatibles, Tomo écoute la chanson pour synchroniser les paroles mot à mot, ou les écrire quand il n'y en a pas
- Le menu des sous-titres les indique activés tant que votre langue de sous-titres enregistrée est affichée
- Les sous-titres dans votre langue enregistrée ne manquent plus quand vous reprenez une vidéo
- Dolby Atmos fonctionne désormais avec les pistes Dolby Digital Plus 7.1, pas seulement 5.1
- Les téléchargements des guides se mettent en pause pendant que vous regardez ou écoutez, et se terminent ensuite
- Les grands guides ne chargent que vos chaînes
```

#### What's New (2.2.12), iOS (698 / 4000 chars)

```text
- Les paroles suivent la chanson dans le lecteur de musique; choisissez une ligne pour y aller
- Les paroles manquantes sont cherchées sur lrclib.net et enregistrées sur votre serveur s'il l'autorise
- Sur les appareils compatibles, Tomo écoute la chanson pour synchroniser les paroles mot à mot, ou les écrire quand il n'y en a pas
- Le menu des sous-titres les indique activés tant que votre langue de sous-titres enregistrée est affichée
- Les sous-titres dans votre langue enregistrée ne manquent plus quand vous reprenez une vidéo
- Dolby Atmos fonctionne désormais avec les pistes Dolby Digital Plus 7.1, pas seulement 5.1
- Les téléchargements des guides se mettent en pause pendant que vous regardez ou écoutez, et se terminent ensuite
- Les grands guides ne chargent que vos chaînes
```

#### What's New (2.2.12), tvOS (889 / 4000 chars)

```text
- Les paroles suivent la chanson dans le lecteur de musique; choisissez une ligne pour y aller
- Les paroles manquantes sont cherchées sur lrclib.net et enregistrées sur votre serveur s'il l'autorise
- Sur les appareils compatibles, Tomo écoute la chanson pour synchroniser les paroles mot à mot, ou les écrire quand il n'y en a pas
- Le lecteur affiche le nom d'une série avec sa saison et son épisode, l'année d'un film, et l'artiste et l'album d'une chanson
- Les infos du lecteur affichent la classification et le genre
- Le menu des sous-titres les indique activés tant que votre langue de sous-titres enregistrée est affichée
- Les sous-titres dans votre langue enregistrée ne manquent plus quand vous reprenez une vidéo
- Dolby Atmos fonctionne désormais avec les pistes Dolby Digital Plus 7.1, pas seulement 5.1
- Les téléchargements des guides se mettent en pause pendant que vous regardez ou écoutez, et se terminent ensuite
- Les grands guides ne chargent que vos chaînes
```

#### What's New (2.2.11), macOS (86 / 4000)

```text
- Tomo TV est maintenant disponible sur les Mac avec processeur Apple Silicon ou Intel
```

#### What's New (2.2.11), iOS (539 / 4000 chars)

```text
- Ajoutez une chaîne à n'importe quel groupe depuis son panneau d'informations
- Les fichiers à plusieurs épisodes affichent toute la plage, comme S01E01-E02
- Les chaînes en direct qui s'affichaient avec des lignes scintillantes sont nettes
- Votre thème colore l'arrière-plan ; choisissez l'illustration ou un fond sobre
- La recherche affiche d'abord les résultats de TV en direct
- Les cartes des chaînes affichent DIRECT seulement tant que leur image est récente
- Les fichiers d'origine se téléchargent en plusieurs parties à la fois
```

#### What's New (2.2.11), tvOS (591 / 4000 chars)

```text
- Ajoutez une chaîne à n'importe quel groupe depuis son panneau d'informations
- Les fichiers à plusieurs épisodes affichent toute la plage, comme S01E01-E02
- Les chaînes en direct qui s'affichaient avec des lignes scintillantes sont nettes
- Votre thème colore l'arrière-plan ; choisissez l'illustration ou un fond sobre
- La recherche affiche d'abord les résultats de TV en direct
- Les cartes des chaînes affichent DIRECT seulement tant que leur image est récente
- Vers la gauche, le guide de TV en direct mène toujours aux chaînes
- De retour d'un programme, le guide garde votre place
```

#### What's New (2.2.10), iOS (2146 / 4000 chars)

```text
- Choisissez quand votre serveur convertit : « Si nécessaire », « Seulement pour les fichiers non pris en charge » ou « Désactivé ». Réglages affiche aussi ce que votre serveur autorise
- Choisissez un thème dans Réglages > Apparence, ou créez et nommez le vôtre. Vos thèmes enregistrés apparaissent sur vos autres appareils connectés au même compte Jellyfin
- La recherche de TV en direct trouve les programmes jusqu'à demain par titre, titre d'épisode ou description, y compris dans vos guides XMLTV
- Choisissez un jour du guide de TV en direct dans le calendrier, jusqu'à deux semaines à l'avance
- Enregistrez les programmes de vos guides XMLTV depuis leur panneau d'informations
- Les programmes en cours d'enregistrement affichent REC dans la recherche de TV en direct
- En faisant défiler une vidéo, l'image suit votre doigt
- Choisissez une taille pour chaque téléchargement : l'original, ou une copie plus légère en 1080p, 720p ou 480p que votre serveur convertit, dans votre langue audio et avec vos sous-titres
- Téléchargements affiche la vitesse de téléchargement en cours
- Maintenez « Reprendre » pour lire depuis le début
- Balayez un panneau d'informations vers la gauche ou la droite pour passer à l'élément voisin, comme l'épisode suivant, même d'une saison à l'autre
- La recherche de l'écran « Chaînes » est un bouton de la barre de navigation qui ouvre « Recherche »
- Avec une langue de sous-titres choisie, sa piste complète se charge au lieu d'une piste de sous-titres forcés seuls
- Les fichiers MP4 dont l'index est à la fin du fichier se lisent à nouveau
- Les téléchargements convertis par votre serveur affichent leurs sous-titres
- Les originaux téléchargés gardent toutes leurs pistes audio
- Quand la conversion par le serveur est limitée, une connexion lente attend le fichier au lieu de s'arrêter sur une erreur
- L'indicateur de chargement reste affiché jusqu'à ce que la vidéo démarre vraiment
- Image dans l'image vous ramène là où vous avez lancé la lecture, et une file d'attente passe à l'élément suivant dans la fenêtre
- L'écran d'erreur affiche un code d'erreur à citer quand vous signalez un problème
```

#### What's New (2.2.10), tvOS (1676 / 4000 chars)

```text
- Choisissez quand votre serveur convertit : « Si nécessaire », « Seulement pour les fichiers non pris en charge » ou « Désactivé ». Réglages affiche aussi ce que votre serveur autorise
- Choisissez un thème dans Réglages > Apparence, ou créez et nommez le vôtre. Vos thèmes enregistrés apparaissent sur vos autres appareils connectés au même compte Jellyfin
- La recherche de TV en direct trouve les programmes jusqu'à demain par titre, titre d'épisode ou description, y compris dans vos guides XMLTV
- Une barre de jours au-dessus des chaînes ouvre le guide de TV en direct sur n'importe quel jour, jusqu'à deux semaines à l'avance
- Enregistrez les programmes de vos guides XMLTV depuis leur panneau d'informations
- Les programmes en cours d'enregistrement affichent REC dans la recherche de TV en direct
- En faisant défiler une vidéo, un aperçu de la scène s'affiche au-dessus de la barre de lecture
- Maintenez « Reprendre » pour lire depuis le début
- Avec les sous-titres automatiques activés, la piste de sous-titres activée par l'Apple TV se charge
- Avec une langue de sous-titres choisie, sa piste complète se charge au lieu d'une piste de sous-titres forcés seuls
- Les fichiers MP4 dont l'index est à la fin du fichier se lisent à nouveau
- Quand la conversion par le serveur est limitée, une connexion lente attend le fichier au lieu de s'arrêter sur une erreur
- L'indicateur de chargement reste affiché jusqu'à ce que la vidéo démarre vraiment
- Image dans l'image vous ramène là où vous avez lancé la lecture, et une file d'attente passe à l'élément suivant dans la fenêtre
- L'écran d'erreur affiche un code d'erreur à citer quand vous signalez un problème
```

#### What's New (2.2.9), iOS (712 / 4000 chars)

```text
- Les remux 4K sont lus en pleine qualité sur un réseau rapide au lieu de passer à une qualité inférieure
- Filtrez le guide de TV en direct par favoris, vos propres groupes, groupes de listes de lecture et catégories
- Ajoutez des guides XMLTV pour les chaînes sans programme et voyez à quelles chaînes chacun correspond
- La recherche trouve les chaînes et programmes de TV en direct
- Les cartes des chaînes montrent des images en direct, et les chaînes hors ligne peuvent être masquées
- Enregistrez une chaîne, ajoutez-la aux favoris et à des groupes depuis son panneau d'informations
- Les administrateurs peuvent supprimer des éléments du serveur
- Réglages affiche la vraie vitesse d'une connexion rapide
```

#### What's New (2.2.9), tvOS (1006 / 4000 chars)

```text
- Les remux 4K démarrent plus vite, sont lus en pleine qualité sur un réseau rapide et ne ferment plus l'application en plein film
- TV en direct a son propre onglet
- Enregistrez ce qui passe et ajoutez aux favoris depuis les contrôles de lecture
- Filtrez le guide de TV en direct par favoris, vos propres groupes, groupes de listes de lecture et catégories
- Ajoutez des guides XMLTV pour les chaînes sans programme et voyez à quelles chaînes chacun correspond
- La recherche trouve les chaînes et programmes de TV en direct
- Les cartes des chaînes montrent des images en direct, et les chaînes hors ligne peuvent être masquées
- Enregistrez une chaîne, ajoutez-la aux favoris et à des groupes depuis son panneau d'informations
- Les administrateurs peuvent supprimer des éléments du serveur
- Réglages affiche la vraie vitesse de votre connexion et la mesure à nouveau quand vous la sélectionnez
- Une chaîne en direct qui s'arrête n'envoie plus l'application en arrière-plan depuis son écran d'erreur
```

#### What's New (2.2.8), iOS (438 / 4000 chars)

```text
- Vos choix d'audio et de sous-titres sont enregistrés dans votre compte Jellyfin et s'appliquent sur tous vos appareils
- TV en direct sur iPhone : faites glisser le nouveau curseur en verre pour redimensionner la colonne des chaînes
- Une icône d'app rafraîchie
- La piste audio et les sous-titres choisis ne changent plus quand vous revenez dans l'app
- Les sous-titres ne se désactivent plus quand un fichier nomme la langue autrement
```

#### What's New (2.2.8), tvOS (295 / 4000 chars)

```text
- Vos choix d'audio et de sous-titres sont enregistrés dans votre compte Jellyfin et s'appliquent sur tous vos appareils
- La piste audio et les sous-titres choisis ne changent plus quand vous revenez dans l'app
- Les sous-titres ne se désactivent plus quand un fichier nomme la langue autrement
```

#### What's New (2.2.7), iOS (1213 / 4000 chars)

```text
- La lecture suit votre connexion : qualité d'origine quand elle est rapide, flux plus légers quand elle est lente, et retour à la qualité d'origine dès qu'elle se rétablit
- Guide TV en direct : redimensionnez la colonne des chaînes ou réduisez-la aux logos, et les cases vides indiquent qu'une chaîne n'a pas de programme
- Chaînes TV en direct : toutes les chaînes sur une seule page, chaque carte avec un aperçu en direct
- Favoris TV en direct : maintenez une chaîne pour la mettre en favori, puis affichez uniquement les favoris, triez par numéro ou par nom, ou suspendez les aperçus
- Les enregistrements ont des filtres, et « Afficher dans le dossier » ouvre un enregistrement à cet endroit
- Cartes d'accueil plus grandes avec un visuel 3:2 plus net, et les affiches tirées de la vidéo perdent leurs bandes noires
- Les vidéos 8K que l'appareil ne lit pas directement sont diffusées depuis le serveur sans saccades
- La carte du morceau en cours affiche les barres de niveau
- Une vidéo qui échoue sans cesse affiche son erreur au lieu de réessayer indéfiniment
- Correction du choix de piste audio pour les vidéos avec des sous-titres séparés, et un livre impossible à afficher ne bloque plus le lecteur
```

#### What's New (2.2.7), tvOS (1190 / 4000 chars)

```text
- La lecture suit votre connexion : qualité d'origine quand elle est rapide, flux plus légers quand elle est lente, et retour à la qualité d'origine dès qu'elle se rétablit
- Chaînes TV en direct : toutes les chaînes sur une seule page, chaque carte avec un aperçu en direct
- Favoris TV en direct : maintenez une chaîne pour la mettre en favori, puis affichez uniquement les favoris, triez par numéro ou par nom, ou suspendez les aperçus
- Les enregistrements ont des filtres, et « Afficher dans le dossier » ouvre un enregistrement à cet endroit
- La navigation dans les dossiers masque la barre d'onglets, un bouton Accueil ramène en une pression, et le fond du dossier prend la couleur de son visuel
- Cartes d'accueil plus grandes avec un visuel 3:2 plus net et une troisième rangée visible, et les affiches tirées de la vidéo perdent leurs bandes noires
- Les vidéos 8K que l'Apple TV ne lit pas directement sont diffusées depuis le serveur sans saccades
- Une vidéo qui échoue sans cesse affiche son erreur au lieu de réessayer indéfiniment
- Correction du choix de piste audio pour les vidéos avec des sous-titres séparés, et un livre impossible à afficher ne bloque plus le lecteur
```

#### What's New (2.2.6), iOS (896 / 4000 chars)

```text
- TV en direct : un guide par heure et chaîne, les enregistrements et la programmation, avec les chaînes lues sur l'appareil plutôt que par le serveur
- Les livres et bandes dessinées de votre médiathèque s'ouvrent dans un lecteur : PDF, EPUB, MOBI, AZW, CBZ et CBR
- Allemand, français et espagnol, suivant la langue de votre appareil
- Les connexions enregistrées se trouvent sous la liste des serveurs sous forme d'avatars, et un seul tap permet de se reconnecter
- Analyser le réseau répertorie tous les serveurs Jellyfin sur un hôte et balaye les ports courants de la deuxième instance
- Les films avec sous-titres démarrent plus rapidement : votre appareil lit les sous-titres lui-même, là où le serveur passait auparavant plusieurs secondes à les préparer avant la lecture.
- Les pistes de sous-titres ASS et SSA sont également lues sur l'appareil et s'affichent en même temps que l'image.
```

#### What's New (2.2.6), tvOS (983 / 4000 chars)

```text
- TV en direct : un guide par heure et chaîne, les enregistrements et la programmation, avec les chaînes lues sur l'Apple TV plutôt que par le serveur, et le geste de saut de chaîne de la télécommande pour passer de l'une à l'autre
- Les livres et bandes dessinées de votre médiathèque s'ouvrent dans un lecteur : PDF, EPUB, MOBI, AZW, CBZ et CBR
- Allemand, français et espagnol, suivant la langue de votre Apple TV
- Les connexions enregistrées se trouvent à côté de la liste des serveurs sous forme d'avatars, et un seul clic permet de se reconnecter
- Analyser le réseau répertorie tous les serveurs Jellyfin sur un hôte et balaye les ports courants de la deuxième instance
- Les films avec sous-titres démarrent plus rapidement : votre Apple TV lit les sous-titres lui-même, là où le serveur passait auparavant plusieurs secondes à les préparer avant la lecture.
- Les pistes de sous-titres ASS et SSA sont également lues sur l'Apple TV et s'affichent en même temps que l'image.
```

#### What's New (2.2.5), iOS (824 / 4000 chars)

```text
- SyncPlay: regardez ensemble avec tout votre serveur Jellyfin, en synchronisation
- Les films HEVC 10 bits se lisent à nouveau sur les appareils sans décodeur HEVC, convertis sur l'appareil ou par le serveur au lieu de ne pas démarrer
- Un film plus haut que ce que le décodeur de votre appareil accepte est converti plutôt que laissé à saccader
- Ouvrir un gros fichier ne bloque plus l'app jusqu'à l'arrivée de ses listes de lecture
- Les affiches tirées d'un fichier évitent les fondus et les images noires et gardent les bonnes couleurs
- Les films HDR se lisent maintenant quand le serveur les convertit
- Les gros films sur connexion lente ne retombent plus sur la conversion par le serveur
- Diagnostics est un document structuré avec l'appareil, le système et ce qu'il décode, prêt à coller dans un rapport de bogue
```

#### What's New (2.2.5), tvOS (576 / 4000 chars)

```text
- SyncPlay: regardez ensemble avec tout votre serveur Jellyfin, en synchronisation
- L'Apple TV HD lit à nouveau les films HEVC 10 bits, convertis sur l'appareil ou par le serveur au lieu de ne pas démarrer
- Un film plus haut que ce que le décodeur de l'Apple TV accepte est converti plutôt que laissé à saccader
- Ouvrir un gros fichier ne bloque plus l'app jusqu'à l'arrivée de ses listes de lecture
- Les affiches tirées d'un fichier évitent les fondus et les images noires et gardent les bonnes couleurs
- Les films HDR se lisent maintenant quand le serveur les convertit
```

#### What's New (2.2.1), iOS (1681 / 4000 chars)

```text
- Pincez pour zoomer sur une photo, touchez deux fois pour zoomer sur l'endroit touché ou revenir en arrière, et partagez-la depuis son panneau d'informations
- Faites glisser vers la gauche ou la droite pour changer de photo, sans zones de toucher latérales qui gênent le geste, et vers le bas pour fermer la visionneuse
- La fermeture et le diaporama de la visionneuse sont une seule commande en verre qui les déploie d'elle-même
- Les photos ouvrent celle que vous avez vraiment choisie, depuis un panneau d'informations ou depuis les rangées « Nouveautés », « Favoris » et « Recherche »
- « Afficher dans le dossier » arrive avec l'élément à l'écran et sélectionné au lieu d'y défiler plus tard
- Clavier physique sur Mac : la barre d'espace et Retour lancent et mettent en pause, les flèches avancent ou reculent de quinze secondes, et un double-clic sur une vidéo remplit le cadre
- La pochette du lecteur de musique est une carte arrondie sur un voile d'elle-même, dégagée de la barre de lecture dans toute fenêtre
- Les boutons de saut du mini-lecteur s'estompent aux extrémités de la file d'attente, et un appui sur Pause ne tombe plus sur Suivant
- Diagnostic, dans Réglages sous « À propos de Tomo TV » : ce que le moteur a fait lors de la dernière lecture, la voie choisie et pourquoi il a refusé un fichier, les flux décrits par votre serveur, chaque erreur et la version. Copiez-le dans un rapport de bogue. Seule la dernière session est conservée et elle ne quitte jamais l'appareil
- Les réglages de qualité sont des plafonds, « Jusqu'à 1080p », avec une note sur le moment où un plafond s'applique : une connexion lente, ou un fichier que le serveur doit convertir
```

#### What's New (2.2.1), tvOS (905 / 4000 chars)

```text
- Chapitres : un film ou un épisode avec des marqueurs les liste dans le panneau d'informations du lecteur, et en choisir un y mène directement (#71)
- Les photos ouvrent celle que vous avez vraiment choisie, depuis un panneau d'informations ou depuis les rangées « Nouveautés », « Favoris » et « Recherche »
- « Afficher dans le dossier » arrive avec l'élément à l'écran et sélectionné au lieu d'y défiler plus tard
- Diagnostic, dans Réglages sous « À propos de Tomo TV » : ce que le moteur a fait lors de la dernière lecture, la voie choisie et pourquoi il a refusé un fichier, les flux décrits par votre serveur, chaque erreur et la version. Seule la dernière session est conservée et elle ne quitte jamais l'appareil
- Les réglages de qualité sont des plafonds, « Jusqu'à 1080p », avec une note sur le moment où un plafond s'applique : une connexion lente, ou un fichier que le serveur doit convertir
```

#### What's New (2.2.0), iOS (622 / 4000 chars)

```text
- Téléchargements : gardez un élément ou un dossier entier sur l'appareil et lisez-le sans le serveur ; la progression hors ligne se synchronise ensuite
- Dolby Vision se lit en Dolby Vision, disques double couche compris
- Un mini-lecteur garde la musique pendant que vous naviguez, et les morceaux affichent le disque et la piste au lieu de S1E1 (#68)
- Les dossiers s'ouvrent dans une vraie barre de navigation
- Appuyez longuement sur un résultat de recherche pour ouvrir son panneau d'informations et lisez-le avec votre position et une file d'attente
- Meilleure gestion des listes de lecture de plus de 500 éléments
```

#### What's New (2.2.0), tvOS (489 / 4000 chars)

```text
- Dolby Vision se lit en Dolby Vision, disques double couche compris
- La musique continue quand vous quittez le lecteur, et les morceaux affichent le disque et la piste au lieu de S1E1 (#68)
- Appuyez longuement sur un résultat de recherche pour ouvrir son panneau d'informations et lisez-le avec votre position et une file d'attente
- Les tuiles de bibliothèque indiquent ce qu'elles comptent : épisodes, morceaux, photos
- Meilleure gestion des listes de lecture de plus de 500 éléments
```

### Spanish (es-ES, es-MX)

#### App Name (25 / 30 chars)

```text
Tomo TV, cliente Jellyfin
```

#### Subtitle (29 / 30 chars)

```text
Cine, en vivo, música, libros
```

#### Promotional Text (170 / 170 chars)

```text
Gratis, código abierto, sin anuncios ni cuenta. Reproduce TV en vivo, 4K, Dolby Vision y Dolby Atmos en el reproductor de Apple y halla tu servidor Jellyfin sin escribir.
```

#### Keywords (94 / 100 bytes)

```text
reproductor,descargas,servidor,nas,atmos,dolby,hevc,mkv,subtitulos,audiolibro,cine,comics,epub
```

#### Description (2409 / 4000 chars)

```text
Tomo TV reproduce tu biblioteca de Jellyfin en Apple TV, iPhone, iPad y Mac. Tu dispositivo reproduce el archivo por sí mismo: H.264 y HEVC en cualquier contenedor, con 4K, HDR10, HLG y Dolby Vision incluidos. La mayoría de los demás formatos se convierten en el dispositivo. Tu servidor solo convierte si la conexión es demasiado lenta o el dispositivo no puede reproducir el archivo.

QUÉ LO HACE DISTINTO

- El reproductor de Apple, con AirPlay e Imagen dentro de imagen
- Dolby Atmos y sonido envolvente sin pérdida en calidad original, en las pistas compatibles
- Calidad que se adapta a tu conexión mientras ves
- Descargas en iPhone, iPad y Mac, en calidad original o menor
- Subtítulos de disco (PGS, VobSub, DVB, XSUB) decodificados en el dispositivo
- Televisión en vivo con guía, grupos de canales, favoritos y grabaciones

QUÉ INCLUYE

- Películas, series, música, audiolibros, fotos, libros y cómics
- Búsqueda en tu biblioteca y en Televisión en vivo
- Seguir viendo sincronizado con tu servidor, y A continuación entre episodios
- Top Shelf en el Apple TV con Seguir viendo y tus canales recientes
- Saltar intro y saltar créditos en el Apple TV, cuando tu servidor tiene los marcadores
- Pistas de audio y subtítulos que puedes cambiar al reproducir
- SyncPlay: ve lo mismo al mismo tiempo con otras personas de tu servidor
- Varios servidores y usuarios, sin volver a escribir la contraseña
- Filtros, favoritos y modo aleatorio
- Temas que eliges o creas tú

LISTO EN SEGUNDOS

- «Escanear la red» encuentra los servidores Jellyfin de tu red
- Quick Connect inicia tu sesión desde otra app de Jellyfin
- O escribe solo una IP

CALIDAD

Automático mide tu conexión y empieza con la mejor calidad que admite. O fija un límite de 480p a 4K. La conversión del servidor se puede limitar o desactivar.

PRIVACIDAD

Sin analítica, sin rastreo, sin anuncios, sin cuenta con nosotros. Tus credenciales se quedan en el llavero del dispositivo. Tu biblioteca se transmite directo de tu servidor a tu dispositivo.

Tomo TV no incluye contenido, canales, listas de reproducción ni guías. Reproduce lo que ofrecen tu servidor Jellyfin y las fuentes que añades. Tú eres responsable de tener derecho a usarlos.

Tomo TV es un cliente gratuito, de código abierto e independiente para Jellyfin, y no está afiliado al proyecto Jellyfin ni respaldado por él. Jellyfin es una marca de su titular correspondiente.
```

#### What's New (2.2.13), macOS (634 / 4000)

```text
- TV en vivo: indica cuántas emisiones permite tu proveedor a la vez, o deja que Tomo lo aprenda
- Los canales de un proveedor que permite una sola emisión se abren sin fallos al cambiar de canal
- Un canal en vivo que se corta vuelve por sí solo
- Lo nuevo en tu servidor aparece en Inicio y en las carpetas en cuanto vuelves a abrirlas
- Las vistas previas de los canales se llenan más rápido, y las tarjetas de canal muestran la imagen completa
- En la pantalla Canales, una franja roja bajo cada tarjeta indica lo reciente que es su imagen
- La información de un canal muestra su imagen más reciente, con la vista previa en marcha
```

#### What's New (2.2.13), iOS (634 / 4000 chars)

```text
- TV en vivo: indica cuántas emisiones permite tu proveedor a la vez, o deja que Tomo lo aprenda
- Los canales de un proveedor que permite una sola emisión se abren sin fallos al cambiar de canal
- Un canal en vivo que se corta vuelve por sí solo
- Lo nuevo en tu servidor aparece en Inicio y en las carpetas en cuanto vuelves a abrirlas
- Las vistas previas de los canales se llenan más rápido, y las tarjetas de canal muestran la imagen completa
- En la pantalla Canales, una franja roja bajo cada tarjeta indica lo reciente que es su imagen
- La información de un canal muestra su imagen más reciente, con la vista previa en marcha
```

#### What's New (2.2.13), tvOS (631 / 4000 chars)

```text
- TV en vivo: indica cuántas emisiones permite tu proveedor a la vez, o deja que Tomo lo aprenda
- Los canales de un proveedor que permite una sola emisión se abren sin fallos al cambiar de canal
- Un canal en vivo que se corta vuelve por sí solo
- Lo nuevo en tu servidor aparece en Inicio y en las carpetas en cuanto vuelves a abrirlas
- Las vistas previas de los canales se llenan más rápido, y las tarjetas de canal muestran la imagen completa
- En la pantalla Canales, una franja roja bajo cada tarjeta indica lo reciente que es su imagen
- Top Shelf muestra pósteres creados a partir del video cuando tu servidor no los tiene
```

#### What's New (2.2.12), macOS (611 / 4000)

```text
- La letra sigue la canción en el reproductor de música; elige una línea para saltar a ella
- Las letras que faltan se buscan en lrclib.net y se guardan en tu servidor cuando lo permite
- En dispositivos compatibles, Tomo escucha la canción para sincronizar la letra palabra por palabra, o escribirla cuando no existe
- El menú de subtítulos los muestra activados mientras se ve tu idioma de subtítulos guardado
- Los subtítulos en tu idioma guardado ya no faltan al reanudar un video
- Dolby Atmos ahora funciona también con pistas Dolby Digital Plus 7.1, no solo 5.1
- Las descargas de las guías se pausan mientras ves o escuchas, y terminan después
- Las guías grandes cargan solo tus canales
```

#### What's New (2.2.12), iOS (611 / 4000 chars)

```text
- La letra sigue la canción en el reproductor de música; elige una línea para saltar a ella
- Las letras que faltan se buscan en lrclib.net y se guardan en tu servidor cuando lo permite
- En dispositivos compatibles, Tomo escucha la canción para sincronizar la letra palabra por palabra, o escribirla cuando no existe
- El menú de subtítulos los muestra activados mientras se ve tu idioma de subtítulos guardado
- Los subtítulos en tu idioma guardado ya no faltan al reanudar un video
- Dolby Atmos ahora funciona también con pistas Dolby Digital Plus 7.1, no solo 5.1
- Las descargas de las guías se pausan mientras ves o escuchas, y terminan después
- Las guías grandes cargan solo tus canales
```

#### What's New (2.2.12), tvOS (821 / 4000 chars)

```text
- La letra sigue la canción en el reproductor de música; elige una línea para saltar a ella
- Las letras que faltan se buscan en lrclib.net y se guardan en tu servidor cuando lo permite
- En dispositivos compatibles, Tomo escucha la canción para sincronizar la letra palabra por palabra, o escribirla cuando no existe
- El reproductor muestra el nombre de una serie con su temporada y episodio, el año de una película, y el artista y el álbum de una canción
- La información del reproductor muestra la clasificación y el género
- El menú de subtítulos los muestra activados mientras se ve tu idioma de subtítulos guardado
- Los subtítulos en tu idioma guardado ya no faltan al reanudar un video
- Dolby Atmos ahora funciona también con pistas Dolby Digital Plus 7.1, no solo 5.1
- Las descargas de las guías se pausan mientras ves o escuchas, y terminan después
- Las guías grandes cargan solo tus canales
```

#### What's New (2.2.11), macOS (74 / 4000)

```text
- Tomo TV ya está disponible en Mac con procesadores Apple Silicon e Intel
```

#### What's New (2.2.11), iOS (492 / 4000 chars)

```text
- Añade un canal a cualquier grupo desde su panel de información
- Los archivos con varios episodios muestran el rango completo, como S01E01-E02
- Los canales en vivo que se veían con líneas parpadeantes se ven bien
- Tu tema tiñe el fondo; elige la ilustración o un fondo liso
- La búsqueda muestra primero los resultados de Televisión en vivo
- Las tarjetas de los canales muestran EN VIVO solo mientras su imagen es reciente
- Los archivos originales se descargan en varias partes a la vez
```

#### What's New (2.2.11), tvOS (561 / 4000 chars)

```text
- Añade un canal a cualquier grupo desde su panel de información
- Los archivos con varios episodios muestran el rango completo, como S01E01-E02
- Los canales en vivo que se veían con líneas parpadeantes se ven bien
- Tu tema tiñe el fondo; elige la ilustración o un fondo liso
- La búsqueda muestra primero los resultados de Televisión en vivo
- Las tarjetas de los canales muestran EN VIVO solo mientras su imagen es reciente
- Hacia la izquierda, la guía de Televisión en vivo siempre llega a los canales
- Al volver de un programa, la guía conserva tu lugar
```

#### What's New (2.2.10), iOS (2041 / 4000 chars)

```text
- Elige cuándo convierte tu servidor: «Cuando haga falta», «Solo para archivos no compatibles» o «Desactivada». Ajustes también muestra lo que permite tu servidor
- Elige un tema en Ajustes > Apariencia, o crea el tuyo y ponle nombre. Tus temas guardados aparecen en tus otros dispositivos con la misma cuenta de Jellyfin
- La búsqueda de Televisión en vivo encuentra programas hasta mañana por título, título del episodio o descripción, también en tus guías XMLTV
- Elige un día de la guía de Televisión en vivo en el calendario, hasta con dos semanas de antelación
- Graba programas de tus guías XMLTV desde su panel de información
- Los programas que se están grabando muestran REC en la búsqueda de Televisión en vivo
- Al desplazarte por un video, la imagen sigue tu dedo
- Elige un tamaño para cada descarga: el original, o una copia más pequeña en 1080p, 720p o 480p que convierte tu servidor, en tu idioma de audio y con tus subtítulos
- Descargas muestra a qué velocidad se está descargando
- Mantén pulsado «Reanudar» para reproducir desde el principio
- Desliza un panel de información a la izquierda o a la derecha para pasar al elemento de al lado, como el siguiente episodio, incluso entre temporadas
- La búsqueda de la pantalla «Canales» es un botón de la barra de navegación que abre «Buscar»
- Con un idioma de subtítulos elegido, se carga su pista completa en lugar de una pista solo de subtítulos forzados
- Los archivos MP4 con el índice al final vuelven a reproducirse
- Las descargas que convierte tu servidor muestran sus subtítulos
- Los originales descargados conservan todas sus pistas de audio
- Con la conversión del servidor limitada, una conexión lenta espera al archivo en lugar de detenerse con un error
- El indicador de carga se mantiene hasta que el video empieza de verdad
- Imagen dentro de imagen te lleva de vuelta a donde iniciaste la reproducción, y una cola pasa al siguiente elemento dentro de la ventana
- La pantalla de error muestra un código de error para indicarlo cuando reportes un problema
```

#### What's New (2.2.10), tvOS (1604 / 4000 chars)

```text
- Elige cuándo convierte tu servidor: «Cuando haga falta», «Solo para archivos no compatibles» o «Desactivada». Ajustes también muestra lo que permite tu servidor
- Elige un tema en Ajustes > Apariencia, o crea el tuyo y ponle nombre. Tus temas guardados aparecen en tus otros dispositivos con la misma cuenta de Jellyfin
- La búsqueda de Televisión en vivo encuentra programas hasta mañana por título, título del episodio o descripción, también en tus guías XMLTV
- Una franja de días sobre los canales abre la guía de Televisión en vivo en cualquier día, hasta con dos semanas de antelación
- Graba programas de tus guías XMLTV desde su panel de información
- Los programas que se están grabando muestran REC en la búsqueda de Televisión en vivo
- Al desplazarte por un video, aparece una vista previa de la escena sobre la línea de tiempo
- Mantén pulsado «Reanudar» para reproducir desde el principio
- Con los subtítulos automáticos activados, se carga la pista de subtítulos que activa el Apple TV
- Con un idioma de subtítulos elegido, se carga su pista completa en lugar de una pista solo de subtítulos forzados
- Los archivos MP4 con el índice al final vuelven a reproducirse
- Con la conversión del servidor limitada, una conexión lenta espera al archivo en lugar de detenerse con un error
- El indicador de carga se mantiene hasta que el video empieza de verdad
- Imagen dentro de imagen te lleva de vuelta a donde iniciaste la reproducción, y una cola pasa al siguiente elemento dentro de la ventana
- La pantalla de error muestra un código de error para indicarlo cuando reportes un problema
```

#### What's New (2.2.9), iOS (682 / 4000 chars)

```text
- Los remux 4K se reproducen con calidad completa en una red rápida en lugar de bajar a una menor
- Filtra la guía de Televisión en vivo por favoritos, tus propios grupos, grupos de listas de reproducción y categorías
- Añade guías XMLTV para canales sin programación y mira con qué canales coincidió cada una
- La búsqueda encuentra canales y programas de Televisión en vivo
- Las tarjetas de los canales muestran fotogramas en vivo, y los canales fuera de línea se pueden ocultar
- Graba un canal, márcalo como favorito y agrúpalo desde su panel de información
- Los administradores pueden eliminar elementos del servidor
- Ajustes muestra la velocidad real de una conexión rápida
```

#### What's New (2.2.9), tvOS (980 / 4000 chars)

```text
- Los remux 4K empiezan antes, se reproducen con calidad completa en una red rápida y ya no cierran la app a mitad de la película
- Televisión en vivo tiene su propia pestaña
- Graba lo que se está emitiendo y añádelo a favoritos desde los controles de reproducción
- Filtra la guía de Televisión en vivo por favoritos, tus propios grupos, grupos de listas de reproducción y categorías
- Añade guías XMLTV para canales sin programación y mira con qué canales coincidió cada una
- La búsqueda encuentra canales y programas de Televisión en vivo
- Las tarjetas de los canales muestran fotogramas en vivo, y los canales fuera de línea se pueden ocultar
- Graba un canal, márcalo como favorito y agrúpalo desde su panel de información
- Los administradores pueden eliminar elementos del servidor
- Ajustes muestra la velocidad real de tu conexión y la vuelve a medir cuando la seleccionas
- Un canal en vivo que deja de funcionar ya no envía la app al fondo desde su pantalla de error
```

#### What's New (2.2.8), iOS (411 / 4000 chars)

```text
- Tus opciones de audio y subtítulos se guardan en tu cuenta de Jellyfin y se usan en todos tus dispositivos
- TV en vivo en iPhone: arrastra el nuevo control de cristal para cambiar el ancho de la columna de canales
- Un icono de la app renovado
- La pista de audio y los subtítulos elegidos ya no cambian al volver a la app
- Los subtítulos ya no se desactivan cuando un archivo nombra el idioma de otra forma
```

#### What's New (2.2.8), tvOS (273 / 4000 chars)

```text
- Tus opciones de audio y subtítulos se guardan en tu cuenta de Jellyfin y se usan en todos tus dispositivos
- La pista de audio y los subtítulos elegidos ya no cambian al volver a la app
- Los subtítulos ya no se desactivan cuando un archivo nombra el idioma de otra forma
```

#### What's New (2.2.7), iOS (1207 / 4000 chars)

```text
- La reproducción sigue tu conexión: calidad original cuando es rápida, transmisiones más ligeras cuando es lenta, y de vuelta a la calidad original en cuanto se recupera
- Guía de TV en vivo: cambia el ancho de la columna de canales o contráela a los logotipos, y las celdas vacías indican cuando un canal no tiene programación
- Canales de TV en vivo: todos los canales en una sola pantalla, cada tarjeta con una vista previa en vivo
- Favoritos de TV en vivo: mantén pulsado un canal para marcarlo como favorito, luego muestra solo favoritos, ordena por número o nombre, o pausa las vistas previas
- Grabaciones tiene Filtros, y «Mostrar en la carpeta» abre una grabación allí
- Tarjetas de inicio más grandes con imagen 3:2 más limpia, y los pósteres creados a partir del video pierden sus franjas negras
- Los videos 8K que el dispositivo no reproduce directamente se transmiten desde el servidor sin interrupciones
- La tarjeta de la pista en reproducción muestra las barras de nivel
- Un video que falla una y otra vez muestra su error en lugar de reintentar para siempre
- Corregida la selección de audio en videos con subtítulos separados, y un libro que no se puede mostrar ya no bloquea el lector
```

#### What's New (2.2.7), tvOS (1172 / 4000 chars)

```text
- La reproducción sigue tu conexión: calidad original cuando es rápida, transmisiones más ligeras cuando es lenta, y de vuelta a la calidad original en cuanto se recupera
- Canales de TV en vivo: todos los canales en una sola pantalla, cada tarjeta con una vista previa en vivo
- Favoritos de TV en vivo: mantén pulsado un canal para marcarlo como favorito, luego muestra solo favoritos, ordena por número o nombre, o pausa las vistas previas
- Grabaciones tiene Filtros, y «Mostrar en la carpeta» abre una grabación allí
- La navegación por carpetas oculta la barra de pestañas, con un botón Inicio que vuelve con una sola pulsación, y el fondo de la carpeta toma el color de su imagen
- Tarjetas de inicio más grandes con imagen 3:2 más limpia y una tercera fila a la vista, y los pósteres creados a partir del video pierden sus franjas negras
- Los videos 8K que tu Apple TV no reproduce directamente se transmiten desde el servidor sin interrupciones
- Un video que falla una y otra vez muestra su error en lugar de reintentar para siempre
- Corregida la selección de audio en videos con subtítulos separados, y un libro que no se puede mostrar ya no bloquea el lector
```

#### What's New (2.2.6), iOS (827 / 4000 chars)

```text
- Televisión en vivo: una guía por hora y canal, grabaciones y programación, con canales que se reproducen en el dispositivo en lugar del servidor
- Libros y cómics de tu biblioteca se abren en un lector: PDF, EPUB, MOBI, AZW, CBZ y CBR
- Alemán, francés y español, siguiendo el idioma de tu dispositivo
- Los inicios de sesión guardados aparecen debajo de la lista de servidores como avatares, y un toque reconecta
- Escanear red enumera todos los servidores Jellyfin en un host y explora los puertos comunes de segunda instancia
- Las películas con subtítulos comienzan antes: tu dispositivo lee los subtítulos por sí mismo, donde el servidor solía tardar varios segundos en prepararlos antes de que comenzara la reproducción
- Las pistas de subtítulos ASS y SSA también se leen en el dispositivo y llegan junto con la imagen
```

#### What's New (2.2.6), tvOS (874 / 4000 chars)

```text
- Televisión en vivo: una guía por hora y canal, grabaciones y programación, con canales que se reproducen en el Apple TV en lugar del servidor, y el gesto de salto de canal del mando para cambiar entre ellos
- Los libros y cómics de tu biblioteca se abren en un lector: PDF, EPUB, MOBI, AZW, CBZ y CBR
- Alemán, francés y español, siguiendo el idioma de tu Apple TV
- Los inicios de sesión guardados aparecen junto a la lista de servidores como avatares, y un clic reconecta
- Escanear red enumera cada servidor Jellyfin en un host y escanea los puertos comunes de segunda instancia
- Las películas con subtítulos comienzan antes: tu Apple TV lee los subtítulos por sí mismo, donde el servidor solía tardar varios segundos en prepararlos antes de que comenzara la reproducción
- Las pistas de subtítulos ASS y SSA también se leen en el Apple TV y llegan junto con la imagen
```

#### What's New (2.2.5), iOS (846 / 4000 chars)

```text
- SyncPlay: mira junto con todos en tu servidor Jellyfin, en sincronía
- Las películas HEVC de 10 bits vuelven a reproducirse en dispositivos sin decodificador HEVC, convertidas en el dispositivo o por el servidor en vez de no arrancar
- Una película más alta de lo que admite el decodificador de tu dispositivo se convierte en vez de quedarse a trompicones
- Abrir un archivo grande ya no retiene la app hasta que llegan sus listas de reproducción
- Los pósteres tomados de un archivo evitan fundidos y fotogramas negros y mantienen los colores correctos
- Las películas HDR ya se reproducen cuando el servidor las convierte
- Las películas grandes con conexión lenta ya no recaen en la conversión del servidor
- Diagnóstico es un documento estructurado con el dispositivo, el sistema y lo que decodifica, listo para pegar en un informe de error
```

#### What's New (2.2.5), tvOS (589 / 4000 chars)

```text
- SyncPlay: mira junto con todos en tu servidor Jellyfin, en sincronía
- El Apple TV HD vuelve a reproducir películas HEVC de 10 bits, convertidas en el dispositivo o por el servidor en vez de no arrancar
- Una película más alta de lo que admite el decodificador del Apple TV se convierte en vez de quedarse a trompicones
- Abrir un archivo grande ya no retiene la app hasta que llegan sus listas de reproducción
- Los pósteres tomados de un archivo evitan fundidos y fotogramas negros y mantienen los colores correctos
- Las películas HDR ya se reproducen cuando el servidor las convierte
```

#### What's New (2.2.1), iOS (1521 / 4000 chars)

```text
- Pellizca para ampliar una foto, toca dos veces para ampliar el punto que tocaste o volver atrás, y compártela desde su panel de información
- Desliza a la izquierda o a la derecha para cambiar de foto, sin zonas laterales que estorben el gesto, y hacia abajo para cerrar el visor
- Cerrar y la presentación del visor de fotos son un solo control de cristal que los despliega de sí mismo
- Las fotos abren la que de verdad elegiste, desde un panel de información o desde las filas «Novedades», «Favoritos» y «Buscar»
- «Mostrar en la carpeta» llega con el elemento en pantalla y seleccionado en vez de desplazarse hasta él después
- Teclado físico en el Mac: espacio y Retorno reproducen y pausan, las flechas saltan quince segundos, y un doble clic en un video llena el cuadro
- La carátula del reproductor de música es una tarjeta redondeada sobre un velo de sí misma, libre de la barra de reproducción en cualquier ventana
- Los saltos del minirreproductor se atenúan en los extremos de la cola, y una pulsación en Pausa ya no cae en Siguiente
- Diagnóstico, en Ajustes dentro de «Acerca de Tomo TV»: lo que hizo el motor en la última reproducción, la vía que eligió y por qué rechazó un archivo, los flujos que describió tu servidor, cada error y la versión. Cópialo en un informe de error. Solo se guarda la última sesión y nunca sale del dispositivo
- Las opciones de calidad son techos, «Hasta 1080p», con una nota de cuándo se aplica un techo: una conexión lenta, o un archivo que el servidor tiene que convertir
```

#### What's New (2.2.1), tvOS (821 / 4000 chars)

```text
- Capítulos: una película o un episodio con marcas las muestra en el panel de información del reproductor, y elegir una salta allí (#71)
- Las fotos abren la que de verdad elegiste, desde un panel de información o desde las filas «Novedades», «Favoritos» y «Buscar»
- «Mostrar en la carpeta» llega con el elemento en pantalla y seleccionado en vez de desplazarse hasta él después
- Diagnóstico, en Ajustes dentro de «Acerca de Tomo TV»: lo que hizo el motor en la última reproducción, la vía que eligió y por qué rechazó un archivo, los flujos que describió tu servidor, cada error y la versión. Solo se guarda la última sesión y nunca sale del dispositivo
- Las opciones de calidad son techos, «Hasta 1080p», con una nota de cuándo se aplica un techo: una conexión lenta, o un archivo que el servidor tiene que convertir
```

#### What's New (2.2.0), iOS (590 / 4000 chars)

```text
- Descargas: guarda un elemento o una carpeta entera en el dispositivo y reprodúcelo sin el servidor; el progreso sin conexión se sincroniza después
- Dolby Vision se reproduce como Dolby Vision, discos de doble capa incluidos
- Un minirreproductor mantiene la música mientras navegas, y las canciones muestran disco y pista en lugar de S1E1 (#68)
- Las carpetas se abren en una barra de navegación de verdad
- Mantén pulsado un resultado de búsqueda para ver su panel de información y reprodúcelo con tu posición y una cola
- Mejor manejo de listas de reproducción con más de 500 elementos
```

#### What's New (2.2.0), tvOS (452 / 4000 chars)

```text
- Dolby Vision se reproduce como Dolby Vision, discos de doble capa incluidos
- La música sigue sonando al salir del reproductor, y las canciones muestran disco y pista en lugar de S1E1 (#68)
- Mantén pulsado un resultado de búsqueda para ver su panel de información y reprodúcelo con tu posición y una cola
- Los mosaicos de la biblioteca dicen lo que cuentan: episodios, pistas, fotos
- Mejor manejo de listas de reproducción con más de 500 elementos
```

---

## App Name (30 characters max)

**Tomo TV, a Jellyfin Client**
(26 characters. Read off the live listing 2026-08-19.)

---

## Subtitle/Tagline (30 characters max)

**Movies, Live TV, Music, Books**
(29 characters)

The subtitle is indexed and the description is not, and the keyword field is
full, so this is the only place "live tv" and "books" become searchable. Live TV,
Music and Books are the three lanes the other Apple Jellyfin clients do not field;
Movies anchors the video side and the name carries TV. "4K HDR" went: every
AVPlayer client claims it, and through 2.2.6 it read as "Music in 4K HDR".

---

## Promotional Text (170 characters max)

**Free and open source, no ads, no account. Plays Live TV, 4K, Dolby Vision and Dolby Atmos in Apple's own player, and finds your Jellyfin server with nothing to type.**
(165 characters)

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

Tomo TV plays your Jellyfin library on Apple TV, iPhone, iPad and Mac. Your device plays the file itself: H.264 and HEVC in any container, including 4K, HDR10, HLG and Dolby Vision. Most other formats are converted on the device. Your server transcodes only when the connection is too slow or the device cannot play the file.

WHAT MAKES IT DIFFERENT

- Apple's own player, with AirPlay and Picture in Picture
- Dolby Atmos and lossless surround at original quality, on supported tracks
- Quality that adapts to your connection while you watch
- Downloads on iPhone, iPad and Mac, at original quality or a smaller size
- Disc subtitles (PGS, VobSub, DVB, XSUB) decoded on the device
- Live TV with a guide, channel groups, favorites and recordings

WHAT YOU GET

- Movies, shows, music, audiobooks, photos, books and comics
- Search across your library and Live TV
- Continue Watching in sync with your server, and Up Next between episodes
- Top Shelf on Apple TV with Continue Watching and your recent channels
- Skip Intro and Skip Credits on Apple TV, when your server has the markers
- Audio tracks and subtitles you can switch while watching
- SyncPlay: watch together with others on your server
- Several servers and users, with no password to retype
- Filters, favorites and shuffle
- Themes you pick or make yourself

SET UP IN SECONDS

- Scan Network finds Jellyfin servers on your network
- Quick Connect signs you in from another Jellyfin app
- Or type just an IP

QUALITY

Auto measures your connection and starts at the best quality it can carry. Or set a limit from 480p to 4K. Server transcoding can be limited or turned off.

PRIVACY

No analytics, no tracking, no ads, no account with us. Your credentials stay in the device Keychain. Your library streams straight from your server to your device.

Tomo TV ships no media, channels, playlists or guides. It plays what your Jellyfin server and the sources you add provide, and you are responsible for having the right to access them.

Tomo TV is a free, open-source, independent client for Jellyfin and is not affiliated with or endorsed by the Jellyfin project. Jellyfin is a trademark of its respective owner.

Three claims were cut or corrected against code. "Ambient artwork backdrops while
you browse" was FALSE: components/ambient-background.tsx:48-49 ships one static
baked canvas, and the focus-driven artwork wash "was tried and pulled". "no
restart" on multi-audio holds only on the multi-audio HLS lane
(services/multiAudioLoader.ts:5-6); the fallback rebuilds via
RETRY_WITH_TRANSCODE (hooks/useVideoPlayback.ts:811-844). "background playback on
iPhone" understated it: services/audioQueuePlayer.ts:71 gates on Platform.OS ===
"ios", true on tvOS too.

Original-quality playback preserves supported Atmos and lossless surround.
Smaller server streams use up to stereo AAC; track availability does not
mean unchanged audio encoding. Adaptive sessions include eligible HDR files.
Do not claim that every file plays without server conversion.

---

## Keywords (100 characters max, comma-separated)

**player,downloads,server,nas,atmos,dolby,surround,hevc,mkv,subtitle,selfhosted,audiobook,comics,epub**
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
field on a term already carried by "Tomo TV, a Jellyfin Client" or "Movies, Live TV,
Music, Books".

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

### Version 2.2.5

2.2.5 build 11 (commit be7a984) was published on iOS and tvOS on 2026-09-09. It followed
2.2.3 (released 2026-09-07), so these notes cover 2.2.4 and 2.2.5 on top of it; 2.2.4
changed the icon only. One text
per platform: the HEVC line names the Apple TV HD on tvOS, and Diagnostics on tvOS has
Send to iPhone and no Copy, so its line ends differently. SyncPlay is one line, Jellyfin
users know the feature; the Settings tab badge is iPhone and iPad only and is not
mentioned. The Streaming Quality tick is not mentioned.

iOS:

- SyncPlay: watch together with everyone on your Jellyfin server, in sync
- 10-bit HEVC films play again on devices without an HEVC decoder, converted on the device or by the server instead of failing to start
- A film taller than your device's decoder can handle is converted rather than left to stutter
- Opening a large file no longer holds the app until its playlists arrive
- Posters taken from a file skip fades and black frames and keep the right colours
- HDR films now play when the server converts them
- Large films on a slow connection no longer fall back to server conversion
- Diagnostics is a structured document with the device, the OS and what it decodes, ready to paste into a bug report

tvOS:

- SyncPlay: watch together with everyone on your Jellyfin server, in sync
- Apple TV HD plays 10-bit HEVC films again, converted on the device or by the server instead of failing to start
- A film taller than the Apple TV's decoder can handle is converted rather than left to stutter
- Opening a large file no longer holds the app until its playlists arrive
- Posters taken from a file skip fades and black frames and keep the right colours
- HDR films now play when the server converts them
- Large films on a slow connection no longer fall back to server conversion
- Diagnostics is a structured document with the device, the OS and what it decodes, ready to send to your iPhone

### Version 2.2.3

Went live 2026-09-07 with this text, recovered from the store by iTunes lookup on
2026-09-08 because it was never recorded here. 2.2.1 and 2.2.2 were not released, so
it covers both plus 2.2.3. Only one text was recovered; whether tvOS carried a different
one is not known.

- 10-bit HEVC now plays on devices that cannot decode it, re-encoded on the device instead of failing with "Unable to Play"
- AV1 plays on the device instead of asking the server to transcode it
- Resuming and scrubbing start in seconds instead of stalling, then dropping to server quality
- Better playback on slow connections: the app checks the server can keep up before leaning on it
- Watched and resume marks update right away
- Diagnostics your Apple TV sends arrive as a row in Settings, not a popup, and swipe to email or remove

### Version 2.2.1

Never released: 2.2.3 went live over 2.2.0 and carried this work. Written when the store
had 2.2.0 (confirmed 2026-08-31 by iTunes lookup on trackId 6755077888, released
2026-08-28), so these notes cover only what this build adds on top of it. One text per platform again: the keyboard, the photo viewer's zoom
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

- **Size:** 3840x2160 pixels
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

- **13" Display:** 2064x2752 pixels
- **Required:** 1-10 screenshots

### Mac

- **Size:** 2880x1800 pixels, from the manual captures in `applestore/captures/mac/`
- **Required:** 1-10 screenshots

---

## App Preview Video (Optional, none shipped yet)

15-30 seconds: browse, press play, playback opens instantly, end on the icon and
the live name "Tomo TV, a Jellyfin Client". 1920x1080 for Apple TV, H.264 or
HEVC, M4V/MP4/MOV, max 500 MB.

---

## App Store Review Notes (For Apple Reviewers)

Sent 2026-08-09 as the Resolution Center reply to the iOS 2.0.0 Guideline 2.1
information request (numbered to match Apple's seven questions), with the physical-device
recording attached; item 4 revised for 2.2.6, where the demo row became the Add Server placeholder. Also lives in App Review Information → Notes; adding a platform counts as a
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
iPhone 17 Pro, iOS 27.0 (physical device, via TestFlight). Apple TV 4K (1st generation),
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
No login credentials are needed to review the app. A fresh install opens on a "Who's watching?"
screen; tap Demo to sign into the Tomo TV demo server (tomotv.cubita.studio, run by the
developer), a shared account with no password. Go on the empty Add Server field signs into it
too. It works over the public internet and needs no permissions. Its content is free to use: NASA and ESA space clips and photos, music
from the Internet Archive, public-domain books and Cubita Studio's own shows and channels; each
item names its source and licence, and the demo account is reset every night. Any other Jellyfin
server works too (username and password or Jellyfin Quick Connect).

5. EXTERNAL SERVICES
Two, and no others: (1) the user's own Jellyfin server, at whatever address they enter; all
library, search, playback, progress, and subtitle requests go directly there. (2)
tomotv.cubita.studio, the developer's demo server, only in demo mode. No analytics, crash reporting, advertising or tracking
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
the official Jellyfin client. The demo server's library is public domain, Creative Commons and
the developer's own material, each item naming its source and licence.
```

Demo mode lives in `services/jellyfin/demo.ts`. Its entry points are the Demo face on the Who's
watching screen (`components/settings/WhoIsWatchingScreen.tsx`, shown while no account is saved),
the Add Server placeholder in `components/settings/AddServerRow.tsx` (Go on the empty field) and
"Try Demo Server" in `app/(tabs)/search.tsx`. The server side (libraries, the `demo` user, the nightly reset, the
login disclaimer) is `scripts/demo-account/`.

---

## Build Number & Version Notes

**Live version:** 2.2.11, published 2026-10-13 (iTunes lookup, read 2026-10-17).
**Local version:** 2.2.12, build 17 in app.json.
Check App Store Connect for the last uploaded build before choosing the next number.
**Build Number:** stamped into app.json by `npm run archive -- <buildNumber>`

**Version Naming Convention Going Forward:**

- 1.0.x - Bug fixes, minor tweaks
- 1.x.0 - New features (resume playback, metadata, etc.)
- x.0.0 - Major updates (UI overhaul, new platforms)

---

## Localization

**Current:** English, German, French and Spanish, since 2.2.6, following the device language
(`services/i18n`). The bundle declares no `CFBundleLocalizations`.
**Priority languages for a future release:**

1. Japanese (ja)
2. Portuguese (pt-BR)

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

| Field             | Limit | Current   | Status |
| ----------------- | ----- | --------- | ------ |
| App Name          | 30    | 26        | ✅     |
| Subtitle          | 30    | 29        | ✅     |
| Promotional Text  | 170   | 165       | ✅     |
| Description       | 4,000 | 2,177     | ✅     |
| Keywords          | 100   | 99        | ✅     |
| What's New 2.2.11 | 4,000 | 385 / 448 | ✅     |

Counts use the English canonical blocks; What's New is iOS / tvOS.
Keywords are counted in UTF-8 bytes; other fields use Unicode characters.

Only 160 of these characters are indexed for search: App Name, Subtitle and
Keywords. Description, Promotional Text and What's New contribute nothing to
ranking and exist to convert.

---

## Per-Submission Checklist

Done once and still valid:

- [x] Landing page at `https://keiver.dev/lab/tomotv` (Privacy Policy, Support, Marketing URL)
- [x] Icons generated at prebuild by `tvos-assets/plugin`
- [x] Export compliance: `usesNonExemptEncryption: false` in app.json

Regenerated by `npm run shots` from `applestore/captures/`:

- [x] tvOS screenshots, eight at 3840x2160
- [x] iPhone screenshots, nine at 1320x2868 in the 6.9" slot
- [x] iPad screenshots, nine at 2064x2752
- [x] Mac screenshots, nine at 2880x1800, from the manual captures in `applestore/captures/mac/`

Every submission:

- [ ] Bump build number via `npm run archive -- <n>`, reading the last used value off App Store Connect
- [ ] Fill App Review Information → Notes with the block above
- [ ] Physical-device screen recording if this is a platform's first submission
- [x] Update "What's New" for 2.2.11 in all four languages on iOS, tvOS and macOS
- [ ] Upload the approved 2.2.11 metadata and verify the draft matches

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
