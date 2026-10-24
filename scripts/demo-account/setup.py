#!/usr/bin/env python3
"""Jellyfin side of the demo account, run on the box: the Bookshelf plugin (installed once, for epub metadata), the
demo libraries (added once, a retired one taken out of Jellyfin once, a renamed one renamed once), a scan of each, then the `demo` user (added
once, no password, seed.json's favorites and part-played items applied on creation) with a policy that sees those
libraries, the box's own Shows and Live TV, and each library's own image (library-art/<name>.jpg, which deploy.sh
copies to the library's folder.jpg under config/root/default) read in place of the collage Jellyfin generates. No
other user is read or written. Auth is the admin's newest session token read from a copy of jellyfin.db (the box
has no API keys); it stays in memory, as in demo-livetv/configure.py.

  sudo cp /opt/tomotv/jellyfin/config/data/jellyfin.db /tmp/jf.db && setup.py check|apply|images <directory> /tmp/jf.db <jellyfin ip>

check exits 3 when the plugin or a library is missing, a retired library is still there, a library is to rename or
a library image is to change (deploy.sh backs the config up first), 0 when nothing is to change.
apply exits 4 after installing the plugin: Jellyfin loads it on the next start, and deploy.sh restarts it and runs
apply again.
images refreshes the image of each library whose folder.jpg is not yet the one Jellyfin shows.
"""

import json
import os
import sqlite3
import sys
import time
import urllib.parse
import urllib.request

import reset

PLUGIN = "Bookshelf"
LIBRARIES = [
    {"name": "Space", "type": "movies", "path": "/media/Demo Space", "options": {"EnableInternetProviders": False, "SaveLocalMetadata": False}},
    {"name": "Music", "type": "music", "path": "/media/Demo Music", "options": {"EnableInternetProviders": False, "SaveLocalMetadata": False}},
    {"name": "Books", "type": "books", "path": "/media/Demo Books", "options": {"EnableInternetProviders": False, "SaveLocalMetadata": False}},
    {"name": "Photos", "type": "homevideos", "path": "/media/Demo Photos", "options": {"EnableInternetProviders": False, "SaveLocalMetadata": False, "EnablePhotos": True}},
]
# The box's own libraries the demo user also sees; never created, scanned or changed here.
SHARED_LIBRARIES = ["Shows"]
# Demo libraries that once existed and are taken out of Jellyfin (their files stay on disk).
REMOVED_LIBRARIES = ["Shorts"]
# Libraries renamed once, in this order: the box's own music library takes the name of its folder on disk so the
# demo's can be plain Music. Jellyfin keeps every item's id, and so the user data on it, through a rename.
RENAMED_LIBRARIES = [("Music", "Music Library"), ("Demo Music", "Music")]
DEMO_USER = "demo"
LIBRARY_ART = "library-art"
# The demo user: one shared account, so nothing that reaches other people (SyncPlay, remote control, sharing), no
# server transcoding (Tomo's engine plays everything) and no writes beyond its own played, favorite and download state.
DEMO_POLICY = {
    "IsAdministrator": False,
    "IsHidden": False,
    "IsDisabled": False,
    "EnableAllFolders": False,
    "EnableLiveTvAccess": True,
    "EnableLiveTvManagement": False,
    "EnableContentDeletion": False,
    "EnableContentDeletionFromFolders": [],
    "EnableVideoPlaybackTranscoding": False,
    "EnableAudioPlaybackTranscoding": False,
    "EnablePlaybackRemuxing": False,
    "EnableMediaConversion": False,
    "SyncPlayAccess": "None",
    "EnableLyricManagement": False,
    "EnableSubtitleManagement": False,
    "EnableCollectionManagement": False,
    "EnableRemoteControlOfOtherUsers": False,
    "EnableSharedDeviceControl": False,
    "EnablePublicSharing": False,
    "EnableUserPreferenceAccess": True,
    "EnableMediaPlayback": True,
    "EnableRemoteAccess": True,
    "EnableContentDownloading": True,
    "EnableAllChannels": False,
    "EnabledChannels": [],
    "EnableAllDevices": True,
    "MaxActiveSessions": 0,
    "RemoteClientBitrateLimit": 0,
}
MISSING = 3
RESTART = 4
PLUGIN_WAIT_S = 90


def session(db, ip):
    c = sqlite3.connect(db)
    admin = c.execute("select Id from Users where Username = ?", ("admin",)).fetchone()[0]
    token = c.execute("select AccessToken from Devices where UserId = ? order by DateLastActivity desc limit 1", (admin,)).fetchone()[0]
    c.close()
    os.remove(db)
    base = f"http://{ip}:8096"

    def jf(path, method="GET", body=None):
        req = urllib.request.Request(
            base + path,
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": "MediaBrowser Token=" + token, "Content-Type": "application/json", "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return json.loads(raw) if raw.strip() else None

    if not jf("/Users/Me")["Policy"]["IsAdministrator"]:
        sys.exit("session is not an administrator")
    return jf


def plugin_present(jf):
    return any(p["Name"] == PLUGIN for p in jf("/Plugins"))


def install_plugin(jf):
    jf("/Packages/Installed/" + urllib.parse.quote(PLUGIN), "POST")
    for _ in range(PLUGIN_WAIT_S // 3):
        if plugin_present(jf):
            print(f"{PLUGIN} installed")
            return
        time.sleep(3)
    sys.exit(f"{PLUGIN} did not appear in /Plugins within {PLUGIN_WAIT_S} s")


def setup_branding(jf, directory):
    """The disclosure as the server's login disclaimer, which Jellyfin shows on its sign-in page."""
    with open(os.path.join(directory, "disclosure.txt")) as f:
        text = f.read().strip()
    branding = jf("/System/Configuration/Branding")
    if branding.get("LoginDisclaimer") == text:
        print("login disclaimer present")
        return
    jf("/System/Configuration/Branding", "POST", {"LoginDisclaimer": text, "CustomCss": branding.get("CustomCss") or "", "SplashscreenEnabled": branding.get("SplashscreenEnabled", True)})
    print("login disclaimer written")


def renames_pending(folders):
    names = set(folders)
    pending = []
    for old, new in RENAMED_LIBRARIES:
        if old in names and new not in names:
            pending.append((old, new))
            names.discard(old)
            names.add(new)
    return pending


def library_images_pending(jf, folders, directory):
    """The libraries whose primary image is not yet their folder.jpg at the size media.py wrote."""
    art_dir = os.path.join(directory, LIBRARY_ART)
    pending = []
    for name in sorted(os.listdir(art_dir)) if os.path.isdir(art_dir) else []:
        library = os.path.splitext(name)[0]
        if library not in folders:
            continue
        primary = next((i for i in jf(f"/Items/{folders[library]['ItemId']}/Images") if i["ImageType"] == "Primary"), None)
        wanted = (f"/root/default/{library}/folder.jpg", os.path.getsize(os.path.join(art_dir, name)))
        if primary is None or not primary.get("Path", "").endswith(wanted[0]) or primary.get("Size") != wanted[1]:
            pending.append(library)
    return pending


def setup_library_images(jf, folders, directory):
    """A scan of the library, the refresh that takes folder.jpg over the generated image; an image-only refresh of
    the folder item with ReplaceAllImages generated the collage again (measured on 2026-10-23)."""
    for library in library_images_pending(jf, folders, directory):
        jf(f"/Items/{folders[library]['ItemId']}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default", "POST")
        print(f"{library}: scan started for its image")


def demo_user(jf):
    return next((u for u in jf("/Users") if u["Name"] == DEMO_USER), None)


def setup_user(jf, folders, directory):
    user = demo_user(jf)
    created = user is None
    if created:
        user = jf("/Users/New", "POST", {"Name": DEMO_USER, "Password": ""})
        print(f"user {DEMO_USER} added")
    policy = jf(f"/Users/{user['Id']}")["Policy"]
    names = [lib["name"] for lib in LIBRARIES] + SHARED_LIBRARIES
    wanted = {**policy, **DEMO_POLICY, "EnabledFolders": [folders[name]["ItemId"] for name in names]}
    if wanted == policy:
        print(f"user {DEMO_USER}: policy present")
    else:
        jf(f"/Users/{user['Id']}/Policy", "POST", wanted)
        print(f"user {DEMO_USER}: policy written, sees " + ", ".join(names) + " and Live TV")
    if created:
        favorites, progress, missing = reset.seed(jf, user["Id"], directory)
        print(f"user {DEMO_USER}: {favorites} favorites and {progress} part-played items seeded" + "".join(f"\n  not in the libraries: {m}" for m in missing))


def main(mode, directory, db, ip):
    jf = session(db, ip)
    folders = {f["Name"]: f for f in jf("/Library/VirtualFolders")}
    renames = renames_pending(folders)
    after_renames = {new if name == old else name for name in folders for old, new in [next(((o, n) for o, n in renames if o == name), (None, None))]}
    missing = [lib for lib in LIBRARIES if lib["name"] not in after_renames]
    removed = [name for name in REMOVED_LIBRARIES if name in folders]
    absent = [name for name in SHARED_LIBRARIES if name not in folders]
    if absent:
        sys.exit(f"the box has no library named {', '.join(absent)}")
    plugin = plugin_present(jf)
    if mode == "images":
        setup_library_images(jf, folders, directory)
        return
    if mode == "check":
        print(f"{PLUGIN} plugin: {'present' if plugin else 'missing'}")
        for old, new in renames:
            print(f"{old}: to rename to {new}")
        for lib in LIBRARIES:
            print(f"{lib['name']}: {'present' if lib['name'] in after_renames else 'missing'}")
        for name in removed:
            print(f"{name}: to remove")
        images = library_images_pending(jf, folders, directory)
        for name in images:
            print(f"{name}: library image to change")
        user = demo_user(jf)
        print(f"user {DEMO_USER}: {'present' if user else 'missing'}")
        sys.exit(MISSING if renames or missing or removed or images or not plugin or user is None else 0)
    if not plugin:
        install_plugin(jf)
        sys.exit(RESTART)
    for old, new in renames:
        jf("/Library/VirtualFolders/Name?" + urllib.parse.urlencode({"name": old, "newName": new, "refreshLibrary": "false"}), "POST")
        print(f"{old} renamed to {new}")
    if renames:
        # A renamed library has no folder item until the next library scan (measured 2026-10-23).
        jf("/Library/Refresh", "POST")
        print("library scan started")
    for name in removed:
        jf("/Library/VirtualFolders?" + urllib.parse.urlencode({"name": name, "refreshLibrary": "false"}), "DELETE")
        print(f"{name} removed from Jellyfin (files kept)")
    for lib in missing:
        query = urllib.parse.urlencode({"name": lib["name"], "collectionType": lib["type"], "paths": lib["path"], "refreshLibrary": "false"})
        jf("/Library/VirtualFolders?" + query, "POST", {"LibraryOptions": {**lib["options"], "PathInfos": [{"Path": lib["path"]}]}})
        print(f"{lib['name']} added")
    folders = {f["Name"]: f for f in jf("/Library/VirtualFolders")}
    for lib in LIBRARIES:
        jf(f"/Items/{folders[lib['name']]['ItemId']}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default", "POST")
        print(f"{lib['name']}: scan started")
    setup_user(jf, folders, directory)
    setup_branding(jf, directory)


if __name__ == "__main__":
    if len(sys.argv) != 5 or sys.argv[1] not in ("check", "apply", "images"):
        sys.exit(__doc__)
    main(*sys.argv[1:])
