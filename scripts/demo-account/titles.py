#!/usr/bin/env python3
"""The demo libraries' title list, built here before deploy, one entry per file to place on the box:

  picks.json   the NASA SVS clips kept in the review sheet, one movie file each (`title` replaces the SVS page
               title, `frame_at` cuts the artwork from the clip at that second instead of the page's still,
               `crop` {x 0..1, height 0..1} places the poster's 2:3 window, centred and full height by default)
  music.json   albums on the Internet Archive, every FLAC track and the cover
  books.json   Standard Ebooks epubs, with the year the book first came out
  photos.json  photos by album, with the title and date written into each file
  library-art.json  each library's own image: `source`, a file under the media root (`frame_at` picks a frame of
               a clip), or `file`, a picture of ours in art/; `crop` {height 0..1, x 0..1, y 0..1} places its 16:9
               window, the widest one, centred, by default

The SVS API supplies each clip's title, year, description, credits and still; the Internet Archive's metadata API
each album's track list and tags.

  titles.py <this directory> <build directory>      writes <build>/titles.json
"""

import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request

SVS_API = "https://svs.gsfc.nasa.gov/api/{id}/"
ARCHIVE_API = "https://archive.org/metadata/{id}"
ARCHIVE_DOWNLOAD = "https://archive.org/download/{id}/{name}"
STANDARD_EBOOKS = "https://standardebooks.org/ebooks/{se}/downloads/{file}.epub?source=download"
SPACE = "Demo Space"
MUSIC = "Demo Music"
BOOKS = "Demo Books"
PHOTOS = "Demo Photos"
STUDIO = "NASA Scientific Visualization Studio"
# A still the poster and fanart are cut from: the page's main image when it is at least this wide and close to 16:9, else the largest such still.
STILL_MIN_WIDTH = 1920
STILL_ASPECT = (1.6, 1.85)


def fetch_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=60) as r:
        return json.load(r)


def https(url):
    return re.sub(r"^http://", "https://", url)


def clean_text(text):
    text = text.split("||", 1)[0]
    text = re.sub(r"<[^>]+>", "", html.unescape(text))
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"(?<=[.!?])(?=[A-Z])", " ", text)
    text = re.sub(r"\s*" + chr(0x2014) + r"\s*", ", ", text)
    return re.sub(r"\s+", " ", text).strip().rstrip(",;")


def safe_name(title):
    title = title.replace("‘", "'").replace("’", "'").replace("“", "").replace("”", "")
    title = re.sub(r"[:/\\?*\"<>|]", "", title)
    return re.sub(r"\s+", " ", title).strip(" .")


def instances(item):
    return [entry["instance"] for group in item["media_groups"] for entry in group["items"] if entry.get("type") == "media" and entry.get("instance")]


def is_still(image):
    width, height = image.get("width") or 0, image.get("height") or 0
    jpg_or_png = image["url"].lower().endswith((".jpg", ".jpeg", ".png"))
    return jpg_or_png and width >= STILL_MIN_WIDTH and height > 0 and STILL_ASPECT[0] <= width / height <= STILL_ASPECT[1]


def pick_still(item, media):
    main = item.get("main_image")
    if main and is_still(main):
        return main
    stills = sorted((i for i in media if i["media_type"] == "Image" and is_still(i)), key=lambda i: -(i.get("pixels") or 0))
    return stills[0] if stills else None


def credit_line(item):
    roles = "; ".join(f"{c['role']}: {', '.join(p['name'] for p in c['people'])}" for c in item.get("credits", []) if c.get("people"))
    return "Credit: NASA's Scientific Visualization Studio, public domain" + (f". {roles}" if roles else "") + f". Source: {item['url']}"


def space_title(pick, item):
    title = pick.get("title") or re.sub(r"\s*\(\d{4}\)\s*$", "", item["title"])
    return re.sub(r"\s+", " ", title).strip()


def space_entry(pick):
    item = fetch_json(SVS_API.format(id=pick["id"]))
    media = instances(item)
    movie = next((i for i in media if i["filename"] == pick["movie"]), None)
    if movie is None:
        sys.exit(f"SVS {pick['id']}: no movie named {pick['movie']}; the page lists " + ", ".join(i["filename"] for i in media if i["media_type"] == "Movie"))
    title = space_title(pick, item)
    year = int(item["release_date"][:4])
    name = f"{safe_name(title)} ({year})"
    still = pick_still(item, media)
    return {
        "kind": "movie",
        "library": SPACE,
        "folder": name,
        "file": name + os.path.splitext(movie["filename"])[1].lower(),
        "url": https(movie["url"]),
        "still": https(still["url"]) if still else None,
        "frame_at": pick.get("frame_at"),
        "crop": pick.get("crop"),
        "title": title,
        "year": year,
        "plot": clean_text(item.get("description") or ""),
        "credit": credit_line(item),
        "studio": STUDIO,
        "tags": item.get("keywords", []),
        "source": item["url"],
        "svs": pick["id"],
        "resolution": f"{movie['width']}x{movie['height']}",
    }


def album_entries(album):
    item = fetch_json(ARCHIVE_API.format(id=album["archive"]))
    folder = os.path.join(safe_name(album["artist"]), safe_name(album["album"]))
    # An uploaded track is "<artist> - <album> - <nn> <title>", in the file name or, where the archive squeezed the
    # name, in its title field.
    tracks = []
    for f in item["files"]:
        if not f["name"].lower().endswith(".flac"):
            continue
        match = re.match(r"^(.*)\s-\s(\d+)\s(.+)\.flac$", f["name"]) or re.match(r"^(.*)\s-\s(\d+)\s(.+)$", f.get("title") or "")
        if match:
            tracks.append((int(match.group(2)), match.group(3), f["name"]))
    numbers = [t[0] for t in tracks]
    if not tracks or len(set(numbers)) != len(numbers):
        sys.exit(f"{album['archive']}: tracks could not be numbered from '<artist> - <album> - <nn> <title>': {sorted(numbers)}")
    entries = []
    for number, title, name in sorted(tracks):
        entries.append({
            "kind": "track",
            "library": MUSIC,
            "folder": folder,
            "file": f"{number:02} {safe_name(title)}.flac",
            "url": ARCHIVE_DOWNLOAD.format(id=album["archive"], name=urllib.parse.quote(name)),
        })
    cover = next((f["name"] for f in item["files"] if f["name"].lower() in ("cover.jpg", "cover.png")), None)
    if cover is None:
        sys.exit(f"{album['archive']}: no cover.jpg or cover.png")
    entries.append({"kind": "file", "library": MUSIC, "folder": folder, "file": cover.lower(), "url": ARCHIVE_DOWNLOAD.format(id=album["archive"], name=cover)})
    entries.append({
        "kind": "album",
        "library": MUSIC,
        "folder": folder,
        "file": "album.nfo",
        "title": album["album"],
        "artist": album["artist"],
        "about": album.get("about", ""),
        "credit": f"Licence: {album['licence']}. Source: https://archive.org/details/{album['archive']}",
    })
    return entries


def book_entry(book):
    name = safe_name(book["title"])
    return {
        "kind": "book",
        "library": BOOKS,
        "folder": name,
        "file": name + ".epub",
        "url": STANDARD_EBOOKS.format(se=book["se"], file=book["se"].replace("/", "_")),
        "title": book["title"],
        "author": book["author"],
        "year": book.get("year"),
        "credit": f"Public-domain text; this edition by Standard Ebooks, released under CC0. Source: https://standardebooks.org/ebooks/{book['se']}",
    }


def photo_entry(photo):
    return {
        "kind": "photo",
        "library": PHOTOS,
        "folder": safe_name(photo["album"]),
        "file": safe_name(photo["title"]) + os.path.splitext(urllib.parse.urlparse(photo["url"]).path)[1].lower(),
        "url": photo["url"],
        "title": photo["title"],
        "date": photo.get("date"),
        "credit": photo.get("credit"),
    }


def library_entry(art):
    return {"kind": "library", "library": art["library"], "source": art.get("source"), "file": art.get("file"), "frame_at": art.get("frame_at"), "crop": art.get("crop")}


def load(here, name):
    with open(os.path.join(here, name)) as f:
        return json.load(f)


def main(here, build):
    titles = [space_entry(pick) for pick in load(here, "picks.json")["space"]]
    for album in load(here, "music.json"):
        titles += album_entries(album)
    titles += [book_entry(book) for book in load(here, "books.json")]
    titles += [photo_entry(photo) for photo in load(here, "photos.json")]
    titles += [library_entry(art) for art in load(here, "library-art.json")]
    os.makedirs(build, exist_ok=True)
    with open(os.path.join(build, "titles.json"), "w") as f:
        json.dump(titles, f, indent=1, ensure_ascii=False)
    for t in titles:
        if t["kind"] != "movie":
            continue
        art = f"  (artwork from the frame at {t['frame_at']} s)" if t.get("frame_at") is not None else "" if t.get("still") else "  (no still: artwork from a frame)"
        print(f"{t['library']}/{t['folder']}  <-  {t['url']}{art}")
    for library in (MUSIC, BOOKS, PHOTOS):
        files = [t for t in titles if t["library"] == library and t["kind"] != "library"]
        print(f"{library}: {len(files)} files in {len({t['folder'] for t in files})} folders")
    print(f"library images: {', '.join(t['library'] for t in titles if t['kind'] == 'library')}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
