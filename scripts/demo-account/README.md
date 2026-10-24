# Demo account (tomotv.cubita.studio)

The media Tomo's demo opens on: four libraries built from free sources for a shared `demo` user on the demo box, plus the box's own Shows, by `npm run demo:account`, idempotent on rerun. The Live TV channels come from `scripts/demo-livetv/`.

## What the demo user sees

| Library | Folder on the box | Source                                                                                                                                                 |
| ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Space   | `Demo Space`      | NASA Scientific Visualization Studio clips, public domain; `picks.json` lists the kept page ids, one movie file each, `titles.py` reads the SVS API    |
| Music   | `Demo Music`      | `music.json`: albums on the Internet Archive (CC0 and CC BY), every FLAC track and `cover.jpg`                                                         |
| Books   | `Demo Books`      | `books.json`: Standard Ebooks epubs (CC0 production, public-domain texts), the cover pulled out of each epub, a `.opf` with the first publication year |
| Photos  | `Demo Photos`     | `photos.json`: NASA public domain, ESA/Webb and ESA/Hubble CC BY 4.0, title and date written into each file with exiftool                              |
| Shows   | `Shows`           | The box's own library (Veguitas, Caminandes), shared with the demo user as it is                                                                       |

The box's own music library (Cubita Sessions and format test files, folder `Music Library`) was named "Music" until 2026-10-23; `setup.py` renamed it "Music Library" once, so the demo's library is plain "Music". A "Shorts" library of Blender open movies and public-domain comedies was retired on 2026-10-23 as too close to every other Jellyfin demo; `setup.py` takes it out of Jellyfin, its files sit in `_holding`.

## Files

- `titles.py build`: writes `build/titles.json`, one entry per file to place, from the six json files.
- `media.py` (on the box): places every entry under `/opt/tomotv/media` (a hard link for a `box` path, else a download, resumed on a rerun), the Space poster and fanart (cut from a frame at the pick's `frame_at` second, else from the page's still) and nfo, the book covers and `.opf`, the photo tags, and each library's image from `library-art.json` into `library-art/`. `--redo-art` (`REDO_ART=1 npm run demo:account`) cuts the artwork and library images again.
- `setup.py` (on the box): the Bookshelf plugin, the four demo libraries, a scan of each, then the `demo` user with no password and a policy that sees those libraries, Shows and Live TV, may download and keep its own played, favorite and reading state, cannot transcode on the server, use SyncPlay or manage anything. On creation the user gets `seed.json`. `setup.py images` refreshes a library whose image is not yet its `folder.jpg`. No other user or library is written.
- `reset.py` (on the box, cron `/etc/cron.d/tomotv-demo-reset` at 04:00 UTC): the demo user's played, resumable and favorite state cleared, Live TV favorites removed, demo devices idle over seven days deleted, then `seed.json` applied again: the favorites and part-played items (`at` is the fraction played, for a book the fraction read) that fill Home's Favorites and Continue rows for the demo user. Every call carries the demo user's id. `reset.py capture` prints that state as it is on the server, in `seed.json`'s shape.
- `media.py` also resamples any track above 48 kHz to 48 kHz, 24-bit FLAC, the shape the playback suite proves direct play for (T73).
- `deploy.sh`: all of the above over ssh. Before the first write to Jellyfin (a missing plugin, library or user, a library image to change) it stops Jellyfin, tars `jellyfin/config` into `/opt/tomotv/_holding/`, starts it again and restarts the live TV containers, which share Jellyfin's network namespace. After a plugin install it restarts Jellyfin and runs `setup.py` again. Each library image goes to `folder.jpg` in the library's folder under `jellyfin/config/root/default/`, where the box's other libraries keep theirs (an older `folder.*` of another type goes to `_holding`), and Jellyfin reads it in place of the collage it generates. The Space artwork and the library images come back to `build/review/` for a look. `npm run demo:account -- capture` writes the demo user's favorites and part-played items, as curated on a device, into `seed.json`, so the nightly reset puts that state back.

`.env.demo` at the repo root (gitignored) holds `DEMO_SSH` and `DEMO_SSH_KEY`, as for the live TV deploy. Auth on the box is the admin's newest session token read from a copy of `jellyfin.db`, kept in memory.

## Adding media

- A Space clip: keep it in the review sheet, then add `{ "id", "movie" }` to `picks.json` (the SVS page's MP4 file name; `title` and `frame_at` optional), rerun, look at `build/review/`.
- An album: `{ "artist", "album", "archive" }` in `music.json`; the archive item needs FLAC tracks named `<artist> - <album> - <nn> <title>` (in the file name or its title field) and a `cover.jpg` or `cover.png`.
- A book: `{ "title", "author", "year", "se" }` in `books.json`, `se` the Standard Ebooks path after `/ebooks/`.
- A photo: `{ "album", "title", "date", "url", "credit" }` in `photos.json`.
- A favorite or a part-played item on the demo account: `{ "library", "title" }` or `{ "library", "title", "at" }` in `seed.json`, or curate on a device signed in as `demo` and run `npm run demo:account -- capture`; the nightly reset applies it, or the `reset.py` line below does at once.
- A library's image: `{ "library", "source" }` (a file under the media root, `frame_at` for a clip) or `{ "library", "file" }` (a picture of ours in `art/`) in `library-art.json`, `crop` to place the 16:9 window, `REDO_ART=1` to cut it again after a change.

Removing an entry from a json file never deletes a file on the box: move it to `/opt/tomotv/_holding/` by hand and rescan.

## Check on the box

```
sudo cp /opt/tomotv/jellyfin/config/data/jellyfin.db /tmp/jf.db && sudo chown $(id -u) /tmp/jf.db && \
  python3 /opt/tomotv/demo-account/setup.py check /opt/tomotv/demo-account /tmp/jf.db $(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' jellyfin)
tail /opt/tomotv/demo-account/reset.log
sudo cp /opt/tomotv/jellyfin/config/data/jellyfin.db /tmp/jf.db && sudo chown $(id -u) /tmp/jf.db && \
  python3 /opt/tomotv/demo-account/reset.py /opt/tomotv/demo-account /tmp/jf.db $(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' jellyfin)
```
