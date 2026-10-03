# Demo Live TV (tomotv.cubita.studio)

Ten always-on channels built from the demo media, served to Jellyfin as an M3U tuner with an XMLTV guide, the same shape as the Live TV rig in `test/playback/README.md`. `lineup.json` is the single source of truth; `npm run demo:livetv` deploys it and reruns are idempotent.

## What runs on the box

All under `/opt/tomotv/livetv`, brought up by `/opt/tomotv/docker-compose.override.yml` beside `jellyfin`, every service in jellyfin's network namespace so `127.0.0.1` is shared:

| Service                         | Image                 | Role                                                                                                                          |
| ------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `livetv-<id>` (one per channel) | jellyfin (its ffmpeg) | `broadcast.sh`: rotates the channel's concat list to the wall clock and pushes MPEG-TS to the relay, stream copy, `-re` paced |
| `livetv-relay`                  | python:3-alpine       | `relay.py`: takes each feed on tcp `:91NN+100`, serves readers `http://127.0.0.1:91NN/live.ts` from the live position         |
| `livetv-guide`                  | python:3-alpine       | `guide.py serve`: `live.m3u` + `guide.xml` regenerated every 6 h, logos, served on `:9109`                                    |

Jellyfin reads the tuner at `http://127.0.0.1:9109/live.m3u` and the listing at `http://127.0.0.1:9109/guide.xml`. Programme images are frames `probe.sh` grabs from each source (six per file, spread across its length), served from `frames/` on `:9109`. Recordings land in `/config/data/livetv/recordings` (writable volume).

Nothing is re-encoded: broadcasters stream-copy the originals from `/media`, so every channel must be a codec-uniform set (same codec, resolution and audio format across its files; a single file looped always is). `probe.sh` writes each channel's durations to `channels/<id>.dur`, which gates the broadcasters and the guide.

Schedule: every channel loops its sources from one shared epoch (`lineup.json`), so the guide and the stream agree to within one keyframe, and a restart rejoins at the right offset.

## Deploy

`.env.demo` at the repo root (gitignored):

```
DEMO_SSH=ubuntu@<box>
DEMO_SSH_KEY=~/.ssh/tomotv_deploy
```

No API key: `configure.py` runs on the box and signs its calls with the admin's newest session token read from a copy of `jellyfin.db`, kept in memory.

`npm run demo:livetv` then: flattens the lineup and renders logos into `build/`, rsyncs to the box, probes durations, `docker compose up -d`, and runs `configure.py` there (items.json for titles, tuner and listing if missing, XMLTV cache cleared, Refresh Guide, what is on air).

## Leak watch

Jellyfin writes every open tuner stream to `/cache/transcodes/<id>.ts` for as long as it is open, and only a client's close ends it: an open the app never closed grows on the box's disk at the channel's bitrate until Jellyfin restarts. `leakwatch.py` (deployed beside the other scripts, run by `/etc/cron.d/tomotv-leakwatch` every 30 min) lists the buffers, their growth over a 10 s sample, who is watching and the disk. A buffer growing past 2 min with nobody watching is a leak. Each buffer's live stream id comes from Jellyfin's "Live stream opened" log line; one no session reports playing is closed through `/LiveStreams/Close` once it is 10 min old (previews hold a stream for seconds, the channel ring for 30 s), never while a recording runs. A closed leak is pushed to ntfy; a leak it could not close or under 5 GB free is pushed at high priority (`DEMO_NTFY_TOPIC` in `.env.demo`, copied to `$REMOTE/.env`; `DEMO_NTFY_ALWAYS=1` pushes every run). Under 3 GB free, or Jellyfin down, it restarts Jellyfin and the live TV containers and clears the buffers: Jellyfin refuses to start below its own free-space floor.

From here: `npm run demo:livetv:audit` prints the same report (exit 2 on a leak); `npm run demo:livetv:audit -- --restart` runs the restart.

`lanes.mjs` measures every input a channel preview can read (the origin, the server's `static=true` pass-through, a counted open) with the engine's own grab, counting the box's opens and buffers around each, then checks the server's close rules the app relies on; it exits 1 on a failed expectation. `rig.mjs <jellyfin tag>` stands up a throwaway Jellyfin in Docker fed by `relay.py` (`RELAY_MAX_READERS` with `RELAY_CAP_MODE refuse|kick` plays a provider's connection cap) and prints the `RIG_*` variables `lanes.mjs` reads to measure the rig instead of the demo.

Logos are SVGs in `logos/<id>.svg`, their viewBox cropped to the mark so the app's contain-fit boxes fill with it, rendered by `rsvg-convert` into 1024 px at their own aspect: the title's own logo where one exists (Blender Studio's, embedded as PNG; Veguitas' vector mark from veguitas.com), drawn for Classics and Utopia. A redrawn logo gets a new `?v=` hash in the M3U, and `configure.py` deletes every channel's held image before Refresh Guide so Jellyfin fetches it again.

Sources are paths under `/opt/tomotv/media`. Veguitas loops the library's six episodes, the studio's assembled full stories re-encoded to one format (1080p30 H.264, AAC 48 kHz stereo) so they stream-copy back to back. Files outside every library root (`Live TV/`: 480p H.264 encodes of Blender open movies) have no Jellyfin item, so the guide titles them by file name; they are copied to the box by hand, e.g.

```
scp -i ~/.ssh/tomotv_deploy "Spring.mp4" "$DEMO_SSH:/opt/tomotv/media/Live TV/Spring.mp4"
```

Add a channel: append to `lineup.json` (unique `id`, `number`, `port` 91NN but never 9109, the guide's, codec-uniform sources, `category` Movie / Series / Kids / Sports / News for Jellyfin's genre rows) and draw `logos/<id>.svg`, rerun.

## Check on the box

```
for c in livetv-guide livetv-relay livetv-veguitas; do docker logs --tail 5 $c; done
docker exec jellyfin curl -s http://127.0.0.1:9109/live.m3u
cat /opt/tomotv/livetv/channels/veguitas.dur
```
