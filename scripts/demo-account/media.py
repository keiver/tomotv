#!/usr/bin/env python3
"""The demo libraries' files, run on the box: every entry in titles.json placed under the media root (a hard link
for a file already on the box, a download otherwise). A movie then gets its .nfo and, in the Space library, the
poster and fanart cut from a frame at its `frame_at` second, else from its still, else from a frame at 40%; a
book gets cover.jpg pulled out of its epub and a .opf beside it with the year it first came out and its licence
line; an album gets album.nfo with its licence and source; a photo gets its title, date and credit written into
the file with exiftool; a track above 48 kHz is resampled to 48 kHz, 24-bit FLAC, the shape the playback suite
proves direct play for; a library's own image is a 16:9 window cut from one of its files, or from a picture of
ours in art/, into library-art/ beside titles.json. A rerun leaves a finished entry alone; --redo-art cuts the artwork and library images again.

  media.py <directory with titles.json> <media root> [--redo-art]
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from xml.etree import ElementTree as ET

USER_AGENT = "TomoTVDemo/1.0 (https://tomotv.cubita.studio; demo library build)"
# Where in the clip the fanart frame is taken when the page has no still.
FRAME_AT = 0.4
POSTER = ("1000", "1500")
FANART_WIDTH = "1920"


def run(*cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def remote_size(url):
    """The source's byte count, or -1 when it does not say (a page instead of a file, a refused HEAD)."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT}), timeout=60) as r:
            if r.headers.get("Content-Type", "").startswith("text/"):
                return -1
            return int(r.headers.get("Content-Length") or -1)
    except (urllib.error.URLError, OSError):
        return -1


def download(url, dest):
    run("curl", "-fsSL", "--http1.1", "-A", USER_AGENT, "--retry", "3", "--retry-all-errors", "-C", "-", "-o", dest + ".part", url)
    os.replace(dest + ".part", dest)


def place(entry, root):
    folder = os.path.join(root, entry["library"], entry["folder"])
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, entry["file"])
    if "box" in entry:
        src = os.path.join(root, entry["box"])
        if os.path.exists(dest):
            return dest, "present" if os.path.exists(src) and os.path.samefile(src, dest) else "present (own copy)"
        if not os.path.exists(src):
            return None, f"not under this root: {entry['box']}"
        os.link(src, dest)
        return dest, "linked"
    if os.path.exists(dest):
        # A photo's size changes with the tags written into it and a track's with a resample, so presence is enough.
        want = -1 if entry["kind"] in ("photo", "track") else remote_size(entry["url"])
        if want < 0 or os.path.getsize(dest) == want:
            return dest, "present"
        print(f"  size differs from the source ({os.path.getsize(dest)} vs {want}), downloading again")
    download(entry["url"], dest)
    return dest, f"downloaded {os.path.getsize(dest) // 1_000_000} MB"


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], check=True, capture_output=True, text=True).stdout
    return float(out.strip() or 0)


def artwork(entry, dest, redo):
    base = os.path.splitext(dest)[0]
    poster, fanart = base + "-poster.jpg", base + "-fanart.jpg"
    if not redo and os.path.exists(poster) and os.path.exists(fanart):
        return "artwork present"
    with tempfile.TemporaryDirectory() as tmp:
        if entry.get("frame_at") is None and entry.get("still"):
            source = os.path.join(tmp, "still" + os.path.splitext(entry["still"])[1].lower())
            download(entry["still"], source)
            how = "still"
        else:
            at = entry["frame_at"] if entry.get("frame_at") is not None else duration(dest) * FRAME_AT
            source = os.path.join(tmp, "frame.png")
            run("ffmpeg", "-v", "error", "-y", "-ss", f"{at:.2f}", "-i", dest, "-frames:v", "1", source)
            how = f"frame at {at:.0f} s"
        run("ffmpeg", "-v", "error", "-y", "-i", source, "-vf", f"scale={FANART_WIDTH}:-2", "-q:v", "2", fanart)
        run("ffmpeg", "-v", "error", "-y", "-i", source, "-vf", f"{poster_crop(entry.get('crop'))},scale={POSTER[0]}:{POSTER[1]}", "-q:v", "2", poster)
    return f"artwork from {how}"


def poster_crop(crop):
    """The 2:3 window the poster is cut from: `height` of the frame's height, its left edge at `x` of the room
    left over, centred vertically; the full-height centred window by default."""
    height = (crop or {}).get("height", 1)
    x = (crop or {}).get("x", 0.5)
    return f"crop=ih*{height}*2/3:ih*{height}:(iw-ih*{height}*2/3)*{x}:(ih-ih*{height})/2"


LIBRARY_ART = "library-art"
LIBRARY_ART_WIDTH = "1920"


def library_crop(crop):
    """The 16:9 window a library image is cut from: `height` of the source's height (the widest window that fits
    by default), its left edge at `x` and top edge at `y` of the room left over, centred by default."""
    height = (crop or {}).get("height", 1)
    x = (crop or {}).get("x", 0.5)
    y = (crop or {}).get("y", 0.5)
    width = f"min(iw,ih*{height}*16/9)"
    return f"crop=w='{width}':h='{width}*9/16':x='(iw-ow)*{x}':y='(ih-oh)*{y}'"


def library_art(entry, directory, root, redo):
    source = os.path.join(directory, entry["file"]) if entry.get("file") else os.path.join(root, entry["source"])
    if not os.path.exists(source):
        return f"not under this root: {entry['source']}" if entry.get("source") else f"missing: {entry['file']}"
    out_dir = os.path.join(directory, LIBRARY_ART)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, entry["library"] + ".jpg")
    if os.path.exists(out) and not redo:
        return "present"
    seek = ["-ss", f"{entry['frame_at']:.2f}"] if entry.get("frame_at") is not None else []
    run("ffmpeg", "-v", "error", "-y", *seek, "-i", source, "-frames:v", "1", "-vf", f"{library_crop(entry.get('crop'))},scale='min({LIBRARY_ART_WIDTH},iw)':-2", "-q:v", "2", out)
    return "written from " + (f"the frame at {entry['frame_at']} s" if seek else "the image")


def nfo(entry, dest):
    movie = ET.Element("movie")
    ET.SubElement(movie, "title").text = entry["title"]
    ET.SubElement(movie, "year").text = str(entry["year"])
    if entry.get("plot"):
        ET.SubElement(movie, "plot").text = "\n\n".join(part for part in (entry["plot"], entry.get("credit")) if part)
    if entry.get("studio"):
        ET.SubElement(movie, "studio").text = entry["studio"]
    if entry.get("tmdb"):
        ET.SubElement(movie, "tmdbid").text = entry["tmdb"]
        ET.SubElement(movie, "uniqueid", type="tmdb", default="true").text = entry["tmdb"]
    for tag in entry.get("tags", []):
        ET.SubElement(movie, "tag").text = tag
    ET.indent(movie)
    ET.ElementTree(movie).write(os.path.splitext(dest)[0] + ".nfo", encoding="utf-8", xml_declaration=True)


TRACK_MAX_RATE = 48000


def track_rate(dest):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", dest], check=True, capture_output=True, text=True).stdout
    return int(out.strip() or 0)


def resample_track(dest):
    rate = track_rate(dest)
    if rate <= TRACK_MAX_RATE:
        return f"{rate} Hz"
    part = dest + ".resampled.flac"
    run("ffmpeg", "-v", "error", "-y", "-i", dest, "-map", "0", "-c:v", "copy", "-c:a", "flac", "-sample_fmt", "s32", "-af", f"aresample={TRACK_MAX_RATE}", part)
    os.replace(part, dest)
    return f"{rate} Hz resampled to {TRACK_MAX_RATE} Hz"


def album_nfo(entry, dest):
    album = ET.Element("album")
    ET.SubElement(album, "title").text = entry["title"]
    ET.SubElement(album, "artist").text = entry["artist"]
    text = "\n\n".join(part for part in (entry.get("about"), entry.get("credit")) if part)
    # Jellyfin reads an album's overview from plot; Kodi names the same text review.
    ET.SubElement(album, "plot").text = text
    ET.SubElement(album, "review").text = text
    ET.indent(album)
    ET.ElementTree(album).write(dest, encoding="utf-8", xml_declaration=True)


def book_cover(dest):
    cover = os.path.join(os.path.dirname(dest), "cover.jpg")
    if os.path.exists(cover):
        return "cover present"
    with zipfile.ZipFile(dest) as epub:
        name = next((n for n in epub.namelist() if os.path.basename(n).lower() in ("cover.jpg", "cover.jpeg")), None)
        if name is None:
            return "no cover in the epub"
        with epub.open(name) as src, open(cover, "wb") as out:
            out.write(src.read())
    return "cover from the epub"


OPF_NS = {"opf": "http://www.idpf.org/2007/opf", "dc": "http://purl.org/dc/elements/1.1/"}


def book_opf(entry, dest):
    """A sidecar named after the epub, which Bookshelf reads before the epub's own package file: the epub's title,
    author and description, with the first publication year in place of the edition date."""
    with zipfile.ZipFile(dest) as epub:
        name = next(n for n in epub.namelist() if n.endswith(".opf"))
        package = ET.fromstring(epub.read(name))
    metadata = package.find("opf:metadata", OPF_NS)
    description = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", metadata.findtext("dc:description", default="", namespaces=OPF_NS))).strip()
    ET.register_namespace("", OPF_NS["opf"])
    ET.register_namespace("dc", OPF_NS["dc"])
    root = ET.Element("{%s}package" % OPF_NS["opf"], version="3.0")
    meta = ET.SubElement(root, "{%s}metadata" % OPF_NS["opf"])
    ET.SubElement(meta, "{%s}title" % OPF_NS["dc"]).text = entry["title"]
    ET.SubElement(meta, "{%s}creator" % OPF_NS["dc"]).text = entry["author"]
    if entry.get("year"):
        ET.SubElement(meta, "{%s}date" % OPF_NS["dc"]).text = f"{entry['year']}-01-01"
    description = "\n\n".join(part for part in (description, entry.get("credit")) if part)
    if description:
        ET.SubElement(meta, "{%s}description" % OPF_NS["dc"]).text = description
    ET.indent(root)
    ET.ElementTree(root).write(os.path.splitext(dest)[0] + ".opf", encoding="utf-8", xml_declaration=True)


def photo_tags(entry, dest):
    current = subprocess.run(["exiftool", "-s3", "-IPTC:ObjectName", "-IPTC:CopyrightNotice", "-IPTC:Caption-Abstract", "-DateTimeOriginal", "-XMP-xmp:CreateDate", dest], capture_output=True, text=True).stdout.splitlines()
    date = entry.get("date")
    stamp = date.replace("-", ":") + " 12:00:00" if date else None
    credit = entry.get("credit") or ""
    esa = "esa" in urllib.parse.urlparse(entry["url"]).netloc
    want = [entry["title"], credit, current[2] if esa and len(current) > 2 else credit] + ([stamp, stamp] if date else [])
    if current == want:
        return "tags present"
    args = [f"-IPTC:ObjectName={entry['title']}", f"-XMP-dc:Title={entry['title']}", f"-IPTC:CopyrightNotice={credit}", f"-XMP-dc:Rights={credit}"]
    # ESA's files carry a written caption, kept; NASA's carry an internal code or nothing, replaced by the credit.
    if "esa" not in urllib.parse.urlparse(entry["url"]).netloc:
        args += [f"-IPTC:Caption-Abstract={credit}", f"-XMP-dc:Description={credit}"]
    if date:
        # Every date field the file may carry, so the shot date wins over a scan or export date.
        args += [f"-AllDates={stamp}", f"-XMP-xmp:CreateDate={stamp}", f"-XMP-xmp:MetadataDate={stamp}", f"-XMP-photoshop:DateCreated={stamp}", f"-IPTC:DateCreated={date.replace('-', ':')}"]
    run("exiftool", "-q", "-overwrite_original", *args, dest)
    return "tags written"


def main(directory, root, redo):
    with open(os.path.join(directory, "titles.json")) as f:
        entries = json.load(f)
    for entry in entries:
        if entry["kind"] == "library":
            print(f"{entry['library']}: library image")
            print("  " + library_art(entry, directory, root, redo))
            continue
        print(f"{entry['library']}/{entry['folder']}/{entry['file']}")
        if entry["kind"] == "album":
            album_nfo(entry, os.path.join(root, entry["library"], entry["folder"], entry["file"]))
            print("  album.nfo written")
            continue
        dest, how = place(entry, root)
        print("  " + how)
        if dest is None:
            continue
        if entry["kind"] == "movie":
            if entry["library"] == "Demo Space":
                print("  " + artwork(entry, dest, redo))
            nfo(entry, dest)
        elif entry["kind"] == "track":
            print("  " + resample_track(dest))
        elif entry["kind"] == "book":
            print("  " + book_cover(dest))
            book_opf(entry, dest)
        elif entry["kind"] == "photo":
            print("  " + photo_tags(entry, dest))
    print(f"{len(entries)} files")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        sys.exit(__doc__)
    main(args[0], args[1], "--redo-art" in sys.argv)
