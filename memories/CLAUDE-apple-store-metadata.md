# App Store Metadata for TomoTV

**Last Updated:** September 13, 2026

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
table; if they ever disagree with these blocks, **these blocks win**. What the
listing actually carries today is recorded under
[The listing as it stands](#the-listing-as-it-stands); the two are not the same
text.

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

### Description (3,652 / 4000)

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

- Movies, shows, seasons, collections, music, playlists, photos and books
- Search across titles, genres, artists and years
- Continue Watching in sync with your server, with the next episode already lined up
- Top Shelf on Apple TV, putting Continue Watching on the home screen
- Up Next between episodes, plus a queue tab inside the player
- Skip Intro and Skip Credits when your server provides the markers
- Long press any card for cast, ratings, plot and full technical detail, plus Resume, Favorite and watched
- Several audio tracks, switchable during playback
- SyncPlay: watch together with everyone on your Jellyfin server, in sync
- Your subtitle choice remembered from one episode to the next
- Music and audiobooks in a gapless queue player with Lock Screen controls
- Photo viewer and slideshow
- Live TV from your tuner: a guide by time and channel, recordings and the schedule, channels played through the device
- Books and comics in a reader: PDF, EPUB, MOBI, AZW, CBZ and CBR
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

Read off App Store Connect on 10 September 2026. `npm run meta:upload` sends the
blocks above and closes every gap in this table.

| Field               | Live                                  | Blocks above | State                     |
| ------------------- | ------------------------------------- | ------------ | ------------------------- |
| App Name            | Tomo TV, a Jellyfin Client            | same         | in step                   |
| Subtitle            | Movies, Shows, Music in 4K HDR        | same         | in step                   |
| Promotional Text    | 138 chars on 2.2.2, 2.2.3 and 2.2.5   | 138          | in step, empty on 2.2.6   |
| Keywords            | slot 3 is `streaming`                 | `downloads`  | one term apart            |
| Description         | 3317 chars                            | 3652         | forked 22 August          |
| What's New 2.2.5    | 712 iOS, 687 tvOS                     | 705, 680     | three wording differences |
| What's New 2.2.6    | empty on both drafts                  | 706, 779     | never uploaded            |
| de-DE, fr-FR, es-ES | every text field empty on both drafts | complete     | never uploaded            |

**The description forked on 22 August.** The block at `8c2f807` is byte-identical
to the listing that shipped as 2.2.0 through 2.2.3. After it the document moved
in git and the listing moved in the browser, and no revision of this file has
ever matched the live text since:

- document: 3243 (`8c2f807`) -> 3203 (`8b5bca6`) -> 3385 (`dcce1f4`) -> 3459 (`be7a984`) -> 3652 (2.2.6, Live TV and books)
- listing: 3243 -> 3317 at 2.2.5, the SyncPlay bullet added and nothing else

Only in the listing: `no subscription`, `not an imitation of it`,
`never paywalled`, `that other clients hand back to the server`. All four were
deleted here by `8b5bca6`, so uploading takes them off the store.

Only in this file: the Downloads bullet, which the live listing does not mention
at all, and the stream-copy phrasing on disc subtitles.

**Promotional text is hand-written in English and does not change per release.**
The same 138 characters went out on 2.2.2, 2.2.3 and 2.2.5, and the block above is
byte-identical to them. Apple opens every new version with the field empty, which
is why 2.2.6 shows nothing yet: `npm run meta:upload` re-sends it. German, French
and Spanish have never had one, so theirs go up for the first time.

The three translations come from the local model like the release notes do, but
only on request: `npm run notes -- --redo promo --write` after the English block
changes. A plain run never rewrites a block the document already holds, so an
archive cannot replace copy a reader has already passed over.

**2.2.5 shipped notes that differ from the ones recorded above.** The store says
`SyncPlay support:`, spells `colors`, and puts the Diagnostics bullet before the
last two. Both platforms, the same three.

---

## Localized paste blocks

Same rule as the English blocks above: these win. Product nouns follow
Jellyfin's own translations, platform nouns follow Apple's localized pages.
Keywords are capped in bytes, not characters, so an accent costs two.

### German (de-DE)

#### App Name (24 / 30 chars)

```text
Tomo TV, Jellyfin-Client
```

#### Subtitle (30 / 30 chars)

```text
Filme, Serien, Musik in 4K HDR
```

#### Promotional Text (143 / 170 chars)

```text
Findet deinen Jellyfin-Server im Netzwerk, nichts einzutippen. Startet sofort in der richtigen Qualität. Spielt alles in Apples eigenem Player.
```

#### Keywords (96 / 100 bytes)

```text
mediaplayer,download,server,nas,atmos,dolby,surround,hevc,codec,mkv,untertitel,heimkino,hörbuch
```

#### Description (3888 / 4000 chars)

```text
Tomo TV spielt deine Jellyfin-Bibliothek in Apples eigenem Player. Kostenlos, quelloffen, und fast nichts muss durch den Transkoder deines Servers.

Apple TV, iPhone und iPad übernehmen die Arbeit, die sonst der Server macht. H.264 und HEVC laufen direkt aus der Datei, in jedem Container. Ältere und seltenere Formate werden auf dem Gerät selbst umgewandelt. Dein Server springt nur ein, wenn nichts anderes greift.

WAS ANDERS IST

- Apples eigener Player, mit den Bedienelementen, Gesten und dem Panel, die du kennst. AirPlay und Bild-in-Bild sind dabei.
- Qualität, die sich anpasst, während der Film weiterläuft. Wird die Verbindung schlechter, geht das Bild herunter und von allein wieder hinauf, ohne Auswahl und ohne Sprung zurück an den Anfang.
- Ton, der nicht mitreduziert wird. Dolby Atmos wird unverändert durchgereicht, TrueHD, DTS-HD Master Audio, PCM und FLAC verlustfrei übertragen. Passt sich das Bild an, wird der Ton nicht neu kodiert.
- Downloads auf iPhone und iPad. Behalte einen Titel oder ein ganzes Verzeichnis auf dem Gerät und spiele es ohne Server in Reichweite; der Fortschritt bleibt erhalten und gleicht sich beim nächsten Mal ab.
- Disc-Untertitel auf dem Gerät. PGS, VobSub, DVB und XSUB werden zu getimten Bitmaps dekodiert und über das Video gezeichnet, damit das Bild eine reine Kopie bleibt.
- Ein Server, der gefunden bleibt. Ändert sich später seine Adresse, erkennt die App denselben Server an seiner Identität und verbindet sich neu, statt dich erneut anmelden zu lassen.

WAS DU BEKOMMST

- Filme, Serien, Staffeln, Sammlungen, Musik, Wiedergabelisten, Fotos und Bücher
- Suche über Titel, Genres, Künstler und Jahre
- Weiterschauen im Gleichstand mit dem Server, die nächste Folge steht schon bereit
- Top Shelf auf dem Apple TV, mit Weiterschauen auf dem Startbildschirm
- Als Nächstes zwischen den Folgen, dazu eine Warteschlange im Player
- Intro und Abspann überspringen, wenn dein Server die Marker liefert
- Langer Druck auf jede Karte für Besetzung, Bewertungen, Handlung und alle technischen Details, dazu Fortsetzen, Favorit und gesehen
- Mehrere Tonspuren, während der Wiedergabe umschaltbar
- SyncPlay: gemeinsam schauen mit allen auf deinem Jellyfin-Server, synchron
- Deine Untertitelwahl wird von Folge zu Folge behalten
- Musik und Hörbücher in einer lückenlosen Warteschlange mit Steuerung im Sperrbildschirm
- Fotoanzeige und Diashow
- Live-TV von deinem Tuner: Fernsehprogramm nach Zeit und Kanal, Aufnahmen und Planung, Kanäle laufen über das Gerät
- Bücher und Comics in einem Reader: PDF, EPUB, MOBI, AZW, CBZ und CBR
- Filter nach Favorit, Genre, Künstler, Jahr und Status, mit Zufallswiedergabe
- Mehrere Server, mehrere Benutzer je Server, und Wechseln ohne erneute Passworteingabe

IN SEKUNDEN EINGERICHTET

- Netzwerk-Scan durchsucht dein Subnetz und listet jeden gefundenen Jellyfin-Server, nichts einzutippen
- Quick Connect: aus einer beliebigen Jellyfin-App bestätigen, kein Passwort auf der Fernbedienung
- Oder nur eine IP eintippen, Protokoll und Port werden für dich gefunden
- Demo-Modus: die ganze App auf Jellyfins öffentlichem Demo-Server testen, bevor du etwas verbindest

QUALITÄT

Auto ist die Voreinstellung, und sie misst, statt zu raten. Die App misst die Verbindung zu jedem Server, merkt sie sich pro Netzwerk und startet in der Qualität, die diese Verbindung trägt, mit deiner Originaldatei als Obergrenze. Feste Stufen von 480p bis 4K gibt es, wenn du die Grenze lieber selbst setzt.

DATENSCHUTZ

Keine Analyse. Kein Tracking. Keine Werbung. Kein Konto bei uns. Deine Zugangsdaten bleiben im Schlüsselbund des Geräts, und das Video läuft direkt von deinem Server auf dein Gerät.

Tomo TV ist ein kostenloser, quelloffener und unabhängiger Client für Jellyfin und steht in keiner Verbindung zum Jellyfin-Projekt und wird von ihm nicht unterstützt. Jellyfin ist eine Marke des jeweiligen Inhabers.
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

### French (fr-FR)

#### App Name (24 / 30 chars)

```text
Tomo TV, client Jellyfin
```

#### Subtitle (28 / 30 chars)

```text
Films, séries, musique en 4K
```

#### Promotional Text (135 / 170 chars)

```text
Trouve votre serveur Jellyfin sur le réseau, rien à saisir. Démarre tout de suite à la bonne qualité. Lit tout dans le lecteur d'Apple.
```

#### Keywords (90 / 100 bytes)

```text
lecteur,média,téléchargement,serveur,nas,atmos,dolby,hevc,codec,mkv,sous-titres,cinéma
```

#### Description (3979 / 4000 chars)

```text
Tomo TV lit votre médiathèque Jellyfin dans le lecteur d'Apple. Gratuit, open source, et presque rien ne passe par le transcodeur de votre serveur.

Votre Apple TV, votre iPhone et votre iPad font le travail que fait d'habitude un serveur. H.264 et HEVC sont lus directement depuis le fichier, dans n'importe quel conteneur. Les formats plus anciens ou plus rares sont convertis sur l'appareil lui-même. Votre serveur n'intervient que dans le cas rare que rien d'autre ne couvre.

CE QUI CHANGE

- Le lecteur d'Apple, avec les commandes, les gestes et le panneau que vous connaissez déjà. AirPlay et Image dans l'image sont inclus.
- Une qualité qui s'adapte pendant que le film continue. Si la connexion faiblit, l'image descend puis remonte d'elle-même, sans rien choisir et sans retour au début.
- Un son qui ne descend pas avec elle. Dolby Atmos passe intact, et TrueHD, DTS-HD Master Audio, PCM et FLAC sont transportés sans perte. Quand l'image s'adapte, l'audio n'est pas réencodé avec elle.
- Téléchargements sur iPhone et iPad. Gardez un élément ou un dossier entier sur l'appareil et lisez-le sans serveur à portée; votre progression est conservée et se synchronise dès qu'il y en a un.
- Sous-titres de disque traités sur l'appareil. PGS, VobSub, DVB et XSUB sont décodés en images horodatées et dessinés par-dessus la vidéo, pour que l'image reste une copie directe.
- Un serveur qui reste trouvé. Si son adresse change plus tard, l'app reconnaît le même serveur à son identité et se reconnecte, au lieu de vous redemander vos identifiants.

CE QUE VOUS AVEZ

- Films, séries, saisons, collections, musique, listes de lecture, photos et livres
- Recherche par titre, genre, artiste et année
- Continuer de regarder synchronisé avec votre serveur, l'épisode suivant déjà prêt
- Top Shelf sur l'Apple TV, qui met Continuer de regarder sur l'écran d'accueil
- À suivre entre les épisodes, et une file d'attente dans le lecteur
- Passer le générique de début et de fin quand votre serveur fournit les marqueurs
- Appui long sur une fiche pour la distribution, les notes, le synopsis et toute la fiche technique, plus Reprendre, Favori et Vu
- Plusieurs pistes audio, changeables pendant la lecture
- SyncPlay: regardez ensemble avec tout votre serveur Jellyfin, en synchronisation
- Votre choix de sous-titres retenu d'un épisode à l'autre
- Musique et livres audio dans une file sans blanc, avec les commandes sur l'écran verrouillé
- Visionneuse de photos et diaporama
- TV en direct : guide, enregistrements, chaînes lues sur l'appareil
- Livres et BD : PDF, EPUB, MOBI, AZW, CBZ, CBR
- Filtres par favori, genre, artiste, année et état de lecture, avec lecture aléatoire
- Plusieurs serveurs, plusieurs utilisateurs sur chacun, et le passage de l'un à l'autre sans ressaisir de mot de passe

CONFIGURÉ EN QUELQUES SECONDES

- L'analyse du réseau parcourt votre sous-réseau et liste chaque serveur Jellyfin trouvé, rien à saisir
- Quick Connect: approuvez depuis n'importe quelle app Jellyfin, aucun mot de passe sur la télécommande
- Ou saisissez seulement une IP, le protocole et le port sont trouvés pour vous
- Mode démo: essayez toute l'app sur le serveur de démonstration public de Jellyfin avant de connecter quoi que ce soit

QUALITÉ

Auto est le réglage par défaut, et il mesure au lieu de deviner. L'app chronomètre la connexion à chaque serveur, la retient par réseau, et ouvre à la qualité que cette connexion supporte, avec votre fichier d'origine comme plafond. Des réglages fixes de 480p à 4K sont là si vous préférez fixer le plafond vous-même.

CONFIDENTIALITÉ

Aucune analyse. Aucun suivi. Aucune publicité. Aucun compte chez nous. Vos identifiants restent dans le trousseau de l'appareil, et la vidéo est diffusée directement de votre serveur vers votre appareil.

Tomo TV est un client gratuit, open source et indépendant pour Jellyfin; il n'est ni affilié au projet Jellyfin ni approuvé par lui. Jellyfin est une marque de son détenteur respectif.
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

### Spanish (es-ES, es-MX)

#### App Name (25 / 30 chars)

```text
Tomo TV, cliente Jellyfin
```

#### Subtitle (29 / 30 chars)

```text
Películas, series y música 4K
```

#### Promotional Text (139 / 170 chars)

```text
Encuentra tu servidor Jellyfin en la red, sin escribir nada. Empieza ya con la calidad justa. Lo reproduce todo en el reproductor de Apple.
```

#### Keywords (88 / 100 bytes)

```text
reproductor,descargas,servidor,nas,atmos,dolby,hevc,codec,mkv,subtitulos,audiolibro,cine
```

#### Description (3933 / 4000 chars)

```text
Tomo TV reproduce tu biblioteca de Jellyfin en el reproductor de Apple. Gratis, de código abierto, y casi nada tiene que pasar por el conversor de tu servidor.

Tu Apple TV, tu iPhone y tu iPad hacen el trabajo que suele hacer un servidor. H.264 y HEVC se reproducen directamente desde el archivo, en cualquier contenedor. Los formatos más antiguos o menos comunes se convierten en el propio dispositivo. Tu servidor solo interviene en el caso raro que no cubre nada más.

QUÉ LO HACE DISTINTO

- El reproductor de Apple, con los controles, los gestos y el panel que ya conoces. AirPlay e Imagen dentro de imagen vienen incluidos.
- Calidad que se adapta mientras la película sigue. Si la conexión baja, la imagen baja y vuelve a subir sola, sin elegir nada y sin volver al principio.
- Sonido que no baja con ella. Dolby Atmos pasa intacto, y TrueHD, DTS-HD Master Audio, PCM y FLAC se transportan sin pérdida. Cuando la imagen se adapta, el audio no se vuelve a codificar.
- Descargas en iPhone y iPad. Guarda un elemento o una carpeta entera en el dispositivo y reprodúcelo sin ningún servidor cerca; tu progreso se conserva y se sincroniza la próxima vez que lo haya.
- Subtítulos de disco resueltos en el dispositivo. PGS, VobSub, DVB y XSUB se decodifican como imágenes con tiempo y se dibujan sobre el vídeo, para que la imagen siga siendo una copia directa.
- Un servidor que sigue encontrándose. Si su dirección cambia más adelante, la app reconoce el mismo servidor por su identidad y se reconecta, en vez de pedirte que inicies sesión otra vez.

QUÉ INCLUYE

- Películas, series, temporadas, colecciones, música, listas de reproducción, fotos y libros
- Búsqueda por título, género, artista y año
- Seguir viendo sincronizado con tu servidor, con el siguiente episodio ya preparado
- Top Shelf en el Apple TV, con Seguir viendo en la pantalla de inicio
- A continuación entre episodios, más una cola dentro del reproductor
- Saltar intro y saltar créditos cuando tu servidor aporta los marcadores
- Mantén pulsada cualquier ficha para ver reparto, valoraciones, sinopsis y toda la ficha técnica, además de Reanudar, Favorito y visto
- Varias pistas de audio, conmutables durante la reproducción
- SyncPlay: ved juntos con todo tu servidor Jellyfin, en sincronía
- Tu elección de subtítulos se recuerda de un episodio al siguiente
- Música y audiolibros en una cola sin silencios, con controles en la pantalla bloqueada
- Visor de fotos y pase de diapositivas
- Televisión en vivo desde tu sintonizador: guía por hora y canal, grabaciones y programación, los canales se reproducen en el dispositivo
- Libros y cómics en un lector: PDF, EPUB, MOBI, AZW, CBZ y CBR
- Filtros por favorito, género, artista, año y estado de reproducción, con aleatorio
- Varios servidores, varios usuarios en cada uno, y cambiar entre ellos sin escribir la contraseña otra vez

LISTO EN SEGUNDOS

- Escanear la red recorre tu subred y lista todos los servidores Jellyfin que encuentra, sin escribir nada
- Quick Connect: aprueba desde cualquier app de Jellyfin, sin contraseña en el mando
- O escribe solo una IP, y el protocolo y el puerto se encuentran por ti
- Modo demo: prueba la app entera en el servidor de demostración público de Jellyfin antes de conectar nada

CALIDAD

Auto es lo predeterminado, y mide en vez de suponer. La app cronometra la conexión con cada servidor, la recuerda por red, y abre con la calidad que esa conexión admite, con tu archivo original como techo. Hay ajustes fijos de 480p a 4K si prefieres poner el techo tú mismo.

PRIVACIDAD

Sin analítica. Sin rastreo. Sin anuncios. Sin cuenta con nosotros. Tus credenciales se quedan en el llavero del dispositivo, y el vídeo va directo de tu servidor a tu dispositivo.

Tomo TV es un cliente gratuito, de código abierto e independiente para Jellyfin, y no está afiliado al proyecto Jellyfin ni respaldado por él. Jellyfin es una marca de su titular correspondiente.
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

#### What's New (2.2.5), iOS (842 / 4000 chars)

```text
- SyncPlay: ved juntos con todo tu servidor Jellyfin, en sincronía
- Las películas HEVC de 10 bits vuelven a reproducirse en dispositivos sin decodificador HEVC, convertidas en el dispositivo o por el servidor en vez de no arrancar
- Una película más alta de lo que admite el decodificador de tu dispositivo se convierte en vez de quedarse a trompicones
- Abrir un archivo grande ya no retiene la app hasta que llegan sus listas de reproducción
- Los pósteres tomados de un archivo evitan fundidos y fotogramas negros y mantienen los colores correctos
- Las películas HDR ya se reproducen cuando el servidor las convierte
- Las películas grandes con conexión lenta ya no recaen en la conversión del servidor
- Diagnóstico es un documento estructurado con el dispositivo, el sistema y lo que decodifica, listo para pegar en un informe de error
```

#### What's New (2.2.5), tvOS (585 / 4000 chars)

```text
- SyncPlay: ved juntos con todo tu servidor Jellyfin, en sincronía
- El Apple TV HD vuelve a reproducir películas HEVC de 10 bits, convertidas en el dispositivo o por el servidor en vez de no arrancar
- Una película más alta de lo que admite el decodificador del Apple TV se convierte en vez de quedarse a trompicones
- Abrir un archivo grande ya no retiene la app hasta que llegan sus listas de reproducción
- Los pósteres tomados de un archivo evitan fundidos y fotogramas negros y mantienen los colores correctos
- Las películas HDR ya se reproducen cuando el servidor las convierte
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
- SyncPlay: watch together with everyone on your Jellyfin server, in sync
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
No login credentials are needed to review the app. On the connect screen (Settings tab), the
Add Server field shows demo.jellyfin.org/stable as its placeholder; press Go on the empty field
and the app signs in automatically to the Jellyfin project's public demo server. It works over
the public internet and needs no permissions. Please note this demo
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

Demo mode lives in `services/jellyfin/demo.ts`; entry points are the Add Server placeholder in
`components/settings/AddServerRow.tsx` (Go on the empty field) and "Try Demo Server" in
`app/(tabs)/search.tsx`.

---

## Build Number & Version Notes

**Version:** 2.2.6, build 10 in app.json, not yet uploaded. 2.2.5 build 11 was published on both platforms 2026-09-09. Pick the build number off App Store Connect
before archiving: 2.1.1 uploaded builds under its own version string and was pulled
from review, so nothing here predicts what 2.2.0 may reuse.
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

| Field            | Limit | Current   | Status |
| ---------------- | ----- | --------- | ------ |
| App Name         | 30    | 26        | ✅     |
| Subtitle         | 30    | 30        | ✅     |
| Promotional Text | 170   | 138       | ✅     |
| Description      | 4,000 | 3,652     | ✅     |
| Keywords         | 100   | 99        | ✅     |
| What's New 2.2.6 | 4,000 | 706 / 779 | ✅     |

Counted, not estimated (script over this file's own copy; What's New is iOS / tvOS,
recounted 2026-09-13). App Store Connect shows the count REMAINING, not used, so it will read
32 / 348 / 3,294 under Promotional Text, Description and What's New (iOS). Do not
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
- [x] Update "What's New" (2.2.6 section above)

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
