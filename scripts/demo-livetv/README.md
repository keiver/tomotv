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

Logos are hand-drawn SVGs in `logos/<id>.svg`, rendered to 512 px PNGs by `rsvg-convert`: a silhouette in the channel colour with white only inside it, since the app draws a white halo round the logo's alpha. A redrawn logo gets a new `?v=` hash in the M3U, and `configure.py` deletes every channel's held image before Refresh Guide so Jellyfin fetches it again.

Sources are paths under `/opt/tomotv/media`. Files outside every library root (`Live TV/`: Veguitas' full story, since the library's Veguitas episodes are placeholder clips of a branded ad, and 480p H.264 encodes of Blender open movies and Sunny) have no Jellyfin item, so the guide titles them by file name; they are copied to the box by hand, e.g.

```
scp -i ~/.ssh/tomotv_deploy "../veguitas.com/public/generated/ep001-welcome-to-veguitas/social/full-story-1772836477502.mp4" "$DEMO_SSH:/opt/tomotv/media/Live TV/Welcome to Veguitas.mp4"
```

Add a channel: append to `lineup.json` (unique `id`, `number`, `port` 91NN but never 9109, the guide's, codec-uniform sources, `category` Movie / Series / Kids / Sports / News for Jellyfin's genre rows) and draw `logos/<id>.svg`, rerun.

## Check on the box

```
for c in livetv-guide livetv-relay livetv-veguitas; do docker logs --tail 5 $c; done
docker exec jellyfin curl -s http://127.0.0.1:9109/live.m3u
cat /opt/tomotv/livetv/channels/veguitas.dur
```
