#!/usr/bin/env node
/**
 * A throwaway Live TV rig on this Mac: relay.py fed a looped fixture (raw MPEG-TS), an M3U naming it, and a fresh
 * Jellyfin container with that M3U as its tuner, an admin and a non-admin user. Runs until Ctrl-C (the container is --rm).
 *   node scripts/demo-livetv/rig.mjs [image tag, default 12.0] [host port, default 18112]
 * Prints RIG_URL, RIG_CONTAINER, RIG_TOKEN (admin) and RIG_USER_TOKEN (non-admin) for lanes.mjs.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TAG = process.argv[2] ?? "12.0";
const PORT = Number(process.argv[3] ?? 18112);
const RELAY_PORT = 19102;
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

// The origin: relay.py on every interface, so the container and this Mac both reach it at the LAN address.
const relayDir = mkdtempSync(join(tmpdir(), "rig-relay-"));
writeFileSync(join(relayDir, "lineup.json"), JSON.stringify({ channels: [{ id: "rig", port: RELAY_PORT }] }));
children.push(spawn("python3", [join(HERE, "relay.py"), relayDir], { stdio: "ignore", env: { ...process.env, RELAY_HOST: "0.0.0.0" } }));
await new Promise((resolve) => setTimeout(resolve, 1000));
children.push(spawn("ffmpeg", ["-v", "error", "-re", "-stream_loop", "-1", "-i", FIXTURE, "-c", "copy", "-f", "mpegts", `tcp://127.0.0.1:${RELAY_PORT + 100}`], { stdio: "ignore" }));

const m3u = `#EXTM3U\n#EXTINF:-1 tvg-id="rig.one" tvg-name="Rig One" group-title="Rig",Rig One\nhttp://${LAN}:${RELAY_PORT}/live.ts\n`;
const m3uServer = createServer((_, response) => response.writeHead(200, { "Content-Type": "audio/x-mpegurl" }).end(m3u)).listen(M3U_PORT, "0.0.0.0");

spawnSync("docker", ["stop", NAME], { stdio: "ignore" });
const run = spawnSync("docker", ["run", "-d", "--rm", "--name", NAME, "-p", `${PORT}:8096`, `jellyfin/jellyfin:${TAG}`], { encoding: "utf8" });
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

await call("/LiveTv/TunerHosts", { method: "POST", token, body: { Type: "m3u", Url: `http://${LAN}:${M3U_PORT}/rig.m3u`, TunerCount: 0, FriendlyName: "Rig" } });
for (let i = 0; ; i++) {
  const channels = await call(`/LiveTv/Channels?UserId=${admin.User.Id}`, { token });
  if (channels.Items.length > 0) break;
  if (i === 5) {
    const tasks = await call("/ScheduledTasks", { token });
    const refresh = tasks.find((t) => t.Key === "RefreshGuide");
    if (refresh) await call(`/ScheduledTasks/Running/${refresh.Id}`, { method: "POST", token });
  }
  if (i > 60) throw new Error("no channels after adding the tuner");
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
console.log(`RIG_URL=${URL_BASE}\nRIG_CONTAINER=${NAME}\nRIG_TOKEN=${token}\nRIG_USER_TOKEN=${userToken}\nRIG_ORIGIN=http://${LAN}:${RELAY_PORT}/live.ts`);
console.log("rig up; Ctrl-C tears it down");
await new Promise(() => {});
void m3uServer;
