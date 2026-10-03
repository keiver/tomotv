#!/usr/bin/env node
/**
 * A throwaway Live TV rig on this Mac: relay.py fed looped fixtures (raw MPEG-TS), a tuner naming them, and a fresh
 * Jellyfin container with that tuner, an admin and a non-admin user. Runs until Ctrl-C (the container is --rm).
 *   node scripts/demo-livetv/rig.mjs [image tag, default 12.0] [host port, default 18112] [flags]
 *     --tuner m3u|hdhomerun   how Jellyfin reads the relay (default m3u; hdhomerun is relay.py's HDHomeRun face)
 *     --captures <dir>        one channel per *.ts in the directory, lineup labels from <name>.json beside it
 *                             ({"videoCodec","audioCodec","hd","name"}); default: the single T01 fixture
 *     --tuners <n>            the tuner count the face reports and the relay caps readers at (default 4)
 *     --pace <fraction:secs>  relay.py RELAY_PACE: each reader held to that share of the live rate for its first seconds
 *     --video-delay <secs>    relay.py RELAY_VIDEO_DELAY: the tuner face withholds video for a reader's first seconds,
 *                             so Jellyfin's probe sees no dimensions and keeps the lineup placeholders (hdhomerun only)
 *     --probesize <v>         JELLYFIN_FFmpeg__probesize for the container (e.g. 5M); unset keeps Jellyfin's 1G
 *     --placeholder-probe     seeds Jellyfin's live probe cache so every open answers with the lineup labels, the state a
 *                             failed probe leaves (jellyfin/jellyfin#18055); the open itself never runs ffprobe
 * Prints RIG_URL, RIG_CONTAINER, RIG_TOKEN (admin) and RIG_USER_TOKEN (non-admin) for lanes.mjs.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { homedir, networkInterfaces, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const positional = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith("--") && !(all[i - 1] ?? "").startsWith("--"));
const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const TAG = positional[0] ?? "12.0";
const PORT = Number(positional[1] ?? 18112);
const TUNER = flag("tuner") ?? "m3u";
const CAPTURES = flag("captures");
const TUNERS = Number(flag("tuners") ?? 4);
const PACE = flag("pace");
const VIDEO_DELAY = flag("video-delay");
const PROBESIZE = flag("probesize");
const PLACEHOLDER_PROBE = process.argv.includes("--placeholder-probe");
const RELAY_PORT = 19102;
const HDHR_PORT = 19190;
const M3U_PORT = 19180;
const FIXTURE = join(homedir(), "Movies/development-videos/T01 DIRECT H264 AAC.mp4");
const NAME = `tomo-rig-${TAG.replace(/\W/g, "")}`;
const LAN = Object.values(networkInterfaces())
  .flat()
  .find((i) => i.family === "IPv4" && !i.internal)?.address;
if (!LAN) throw new Error("no LAN address");
const URL_BASE = `http://127.0.0.1:${PORT}`;
const CLIENT = 'MediaBrowser Client="tomo-rig", Device="tomo-rig", DeviceId="tomo-rig-1", Version="1"';

const children = [];
const stop = () => {
  for (const child of children) child.kill();
  spawnSync("docker", ["stop", NAME], { stdio: "ignore" });
};
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
// Before anything is spawned, so a failure below still stops the relay and ffmpeg.
const fail = (error) => {
  console.error(String(error?.message ?? error).slice(0, 300));
  stop();
  process.exit(1);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

// The channels: one per capture, numbered from 1, each with the labels a real tuner's lineup carries for it.
const channels = CAPTURES
  ? readdirSync(CAPTURES)
      .filter((file) => file.endsWith(".ts"))
      .sort()
      .map((file, i) => {
        const id = basename(file, ".ts");
        const labelsPath = join(CAPTURES, `${id}.json`);
        const labels = existsSync(labelsPath) ? JSON.parse(readFileSync(labelsPath, "utf8")) : {};
        const path = join(CAPTURES, file);
        return { id, number: i + 1, port: RELAY_PORT + i, name: labels.name ?? id, videoCodec: labels.videoCodec, audioCodec: labels.audioCodec, hd: labels.hd, file: path };
      })
  : [{ id: "rig", number: 1, port: RELAY_PORT, name: "Rig One", file: FIXTURE }];

// The origin: relay.py on every interface, so the container and this Mac both reach it at the LAN address.
const relayDir = mkdtempSync(join(tmpdir(), "rig-relay-"));
writeFileSync(join(relayDir, "lineup.json"), JSON.stringify({ channels: channels.map(({ file, ...entry }) => entry) }));
const relayEnv = { ...process.env, RELAY_HOST: "0.0.0.0" };
if (TUNER === "hdhomerun") Object.assign(relayEnv, { RELAY_HDHR_PORT: String(HDHR_PORT), RELAY_ADVERTISE: `http://${LAN}:${HDHR_PORT}`, RELAY_MAX_READERS: String(TUNERS) });
// A reader paced for N seconds trails the feed by up to N seconds of stream; 128 MB per channel holds 90 s of a 12 Mbps mux.
if (PACE) Object.assign(relayEnv, { RELAY_PACE: PACE, RELAY_RING_MB: "128" });
if (VIDEO_DELAY) relayEnv.RELAY_VIDEO_DELAY = VIDEO_DELAY;
children.push(spawn("python3", [join(HERE, "relay.py"), relayDir], { stdio: "inherit", env: relayEnv }));
await new Promise((resolve) => setTimeout(resolve, 1000));
// A capture goes out as its own bytes, looped and paced by its PCRs, the way a tuner hands a mux over:
// every PID (audio description, subtitles, teletext, the dead ones) and the broadcaster's own PID numbers survive,
// where an ffmpeg re-mux keeps one video and one audio and numbers PIDs afresh. Anything else is fed by ffmpeg -re.
// A PCR stamps the arrival time of its own byte; bytes between two PCRs arrive evenly (the T-STD delivery model),
// so a VBR mux is handed over in realtime where a byte rate would starve the reader on its busy stretches.
const pcrSeconds = (body, at) => {
  if (!(body[at + 3] & 0x20) || body[at + 4] < 7 || !(body[at + 5] & 0x10)) return null;
  const base = body[at + 6] * 2 ** 25 + body[at + 7] * 2 ** 17 + body[at + 8] * 2 ** 9 + body[at + 9] * 2 + (body[at + 10] >> 7);
  return base / 90000 + (((body[at + 10] & 1) << 8) | body[at + 11]) / 27e6;
};
const pcrTimeline = (body, file) => {
  const points = [];
  let pid = -1;
  for (let at = 0; at < body.length; at += 188) {
    const seconds = pcrSeconds(body, at);
    if (seconds === null) continue;
    const packetPid = ((body[at + 1] & 0x1f) << 8) | body[at + 2];
    if (pid < 0) pid = packetPid;
    if (packetPid !== pid || (points.length && seconds <= points[points.length - 1].seconds)) continue;
    points.push({ at, seconds });
  }
  if (points.length < 2) fail(`${file}: no PCR timeline`);
  const first = points[0];
  const last = points[points.length - 1];
  const rate = (last.at - first.at) / (last.seconds - first.seconds);
  const span = body.length / rate;
  return {
    timeAt: (at) => {
      let lo = 0;
      let hi = points.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (points[mid].at <= at) lo = mid;
        else hi = mid;
      }
      const a = points[lo];
      const b = points[hi];
      return a.seconds - first.seconds + ((at - a.at) * (b.seconds - a.seconds)) / (b.at - a.at);
    },
    span,
  };
};
const pacedBytes = async (channel) => {
  const whole = readFileSync(channel.file);
  let start = 0;
  while (start < whole.length - 376 && !(whole[start] === 0x47 && whole[start + 188] === 0x47 && whole[start + 376] === 0x47)) start++;
  const body = whole.subarray(start, start + Math.floor((whole.length - start) / 188) * 188);
  const timeline = pcrTimeline(body, channel.file);
  const slice = 350 * 188;
  const socket = connect(channel.port + 100, "127.0.0.1");
  await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
  const began = Date.now();
  for (let loop = 0; ; loop++) {
    for (let at = 0; at < body.length; at += slice) {
      const chunk = body.subarray(at, Math.min(at + slice, body.length));
      if (!socket.write(chunk)) await new Promise((resolve) => socket.once("drain", resolve));
      const ahead = loop * timeline.span + timeline.timeAt(at + chunk.length) - (Date.now() - began) / 1000;
      if (ahead > 0) await new Promise((resolve) => setTimeout(resolve, ahead * 1000));
    }
  }
};
for (const channel of channels) {
  if (channel.file.endsWith(".ts")) void pacedBytes(channel).catch(fail);
  else children.push(spawn("ffmpeg", ["-v", "error", "-re", "-stream_loop", "-1", "-i", channel.file, "-c", "copy", "-f", "mpegts", `tcp://127.0.0.1:${channel.port + 100}`], { stdio: "ignore" }));
}

const m3u = `#EXTM3U\n${channels.map((c) => `#EXTINF:-1 tvg-id="rig.${c.id}" tvg-name="${c.name}" group-title="Rig",${c.name}\nhttp://${LAN}:${c.port}/live.ts\n`).join("")}`;
const m3uServer = createServer((_, response) => response.writeHead(200, { "Content-Type": "audio/x-mpegurl" }).end(m3u)).listen(M3U_PORT, "0.0.0.0");

spawnSync("docker", ["stop", NAME], { stdio: "ignore" });
const dockerEnv = PROBESIZE ? ["-e", `JELLYFIN_FFmpeg__probesize=${PROBESIZE}`] : [];
const run = spawnSync("docker", ["run", "-d", "--rm", "--name", NAME, "-p", `${PORT}:8096`, ...dockerEnv, `jellyfin/jellyfin:${TAG}`], { encoding: "utf8" });
if (run.status !== 0) fail(run.stderr);

const call = async (path, { method = "GET", body, token } = {}) => {
  const response = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: { Authorization: token ? `${CLIENT}, Token="${token}"` : CLIENT, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};
// Jellyfin 12 answers a 503 startup page until it is up; the wizard's own endpoint answering JSON is the signal.
for (let i = 0; ; i++) {
  try {
    const response = await fetch(`${URL_BASE}/Startup/Configuration`, { headers: { Authorization: CLIENT } });
    if (response.ok && (response.headers.get("content-type") ?? "").includes("json")) break;
  } catch {}
  if (i > 90) throw new Error("jellyfin did not come up");
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
// First-run wizard; its endpoints answer only until it completes.
await call("/Startup/Configuration", { method: "POST", body: { UICulture: "en-US", MetadataCountryCode: "US", PreferredMetadataLanguage: "en" } });
await call("/Startup/User");
await call("/Startup/User", { method: "POST", body: { Name: "rig", Password: "rig" } });
await call("/Startup/Complete", { method: "POST" });
const admin = await call("/Users/AuthenticateByName", { method: "POST", body: { Username: "rig", Pw: "rig" } });
const token = admin.AccessToken;
const viewer = await call("/Users/New", { method: "POST", token, body: { Name: "viewer", Password: "viewer" } });
const policy = await call(`/Users/${viewer.Id}`, { token }).then((user) => user.Policy);
await call(`/Users/${viewer.Id}/Policy`, { method: "POST", token, body: { ...policy, IsAdministrator: false, EnableLiveTvAccess: true } });
const userToken = (await call("/Users/AuthenticateByName", { method: "POST", body: { Username: "viewer", Pw: "viewer" } })).AccessToken;

const tunerHost =
  TUNER === "hdhomerun"
    ? { Type: "hdhomerun", Url: `http://${LAN}:${HDHR_PORT}`, TunerCount: TUNERS, FriendlyName: "Rig HDHomeRun" }
    : { Type: "m3u", Url: `http://${LAN}:${M3U_PORT}/rig.m3u`, TunerCount: 0, FriendlyName: "Rig" };
await call("/LiveTv/TunerHosts", { method: "POST", token, body: tunerHost });
let listed = [];
for (let i = 0; ; i++) {
  listed = (await call(`/LiveTv/Channels?UserId=${admin.User.Id}`, { token })).Items;
  if (listed.length >= channels.length) break;
  if (i === 5) {
    const tasks = await call("/ScheduledTasks", { token });
    const refresh = tasks.find((t) => t.Key === "RefreshGuide");
    if (refresh) await call(`/ScheduledTasks/Running/${refresh.Id}`, { method: "POST", token });
  }
  if (i > 60) throw new Error("no channels after adding the tuner");
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
// Jellyfin reads mediainfo/<md5(OpenToken)>.json before it probes a live stream (LiveStreamHelper.AddMediaInfoWithProbe)
// and takes the streams it finds there. A file shaped like the tuner's lineup placeholders gives every open the
// answer a failed probe leaves: the labels verbatim, Index -1, no transcode offered.
if (PLACEHOLDER_PROBE) {
  for (const channel of channels) {
    const item = listed.find((c) => c.Name === channel.name || c.ChannelNumber === String(channel.number));
    if (!item) continue;
    const info = await call(`/Items/${item.Id}/PlaybackInfo?UserId=${admin.User.Id}`, { token });
    const source = info.MediaSources?.[0];
    if (!source?.OpenToken) continue;
    const video = (channel.videoCodec ?? "H264").toLowerCase() === "mpeg2" ? "mpeg2video" : (channel.videoCodec ?? "H264");
    const mediaInfo = {
      Container: "ts",
      Bitrate: channel.hd === 0 ? 2192000 : 15448000,
      MediaStreams: [
        { Type: "Video", Index: 0, Codec: video, IsInterlaced: true, BitRate: channel.hd === 0 ? 2000000 : 15000000, ...(channel.hd === 0 ? {} : { Width: 1920, Height: 1080 }) },
        { Type: "Audio", Index: 1, Codec: channel.audioCodec ?? "AAC", BitRate: channel.hd === 0 ? 192000 : 448000 },
      ],
    };
    // Jellyfin's string.GetMD5(): MD5 over UTF-16LE, read back as a Guid, whose "N" form byte-swaps the first three fields.
    const md5 = createHash("md5").update(source.OpenToken, "utf16le").digest();
    const guidN = Buffer.concat([md5.subarray(0, 4).reverse(), md5.subarray(4, 6).reverse(), md5.subarray(6, 8).reverse(), md5.subarray(8)]).toString("hex");
    const file = `/cache/mediainfo/${guidN}.json`;
    const seeded = spawnSync("docker", ["exec", "-i", NAME, "sh", "-c", `mkdir -p /cache/mediainfo && cat > ${file}`], { input: JSON.stringify(mediaInfo), encoding: "utf8" });
    if (seeded.status !== 0) fail(seeded.stderr);
  }
}

const origin = TUNER === "hdhomerun" ? `http://${LAN}:${HDHR_PORT}/auto/v1` : `http://${LAN}:${RELAY_PORT}/live.ts`;
console.log(`RIG_URL=${URL_BASE}\nRIG_CONTAINER=${NAME}\nRIG_TOKEN=${token}\nRIG_USER_TOKEN=${userToken}\nRIG_ORIGIN=${origin}`);
for (const channel of channels) {
  const item = listed.find((c) => c.Name === channel.name || c.ChannelNumber === String(channel.number));
  console.log(`channel ${channel.number} ${channel.name}: id=${item?.Id ?? "?"} labels=${channel.videoCodec ?? "-"}/${channel.audioCodec ?? "-"} hd=${channel.hd ?? "-"}`);
}
console.log("rig up; Ctrl-C tears it down");
await new Promise(() => {});
void m3uServer;
