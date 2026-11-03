import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { providerRefused, textSidecarBeside } from "../playback-regression.mjs";

test("a channel the provider's connection limit refused is retried, any other failure is not", () => {
  assert.equal(providerRefused([{ event: "errorCode", code: "PB-LIVE-LIMIT · ENG" }]), true);
  assert.equal(providerRefused([{ event: "errorCode", code: "PB-ENGINE-FAILED · ENG" }]), false);
  assert.equal(providerRefused([]), false);
});

test("a subtitle file named after the video is found beside it, and one named after another video is not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-"));
  const video = path.join(dir, "T44 clip.mkv");
  fs.writeFileSync(video, "");
  fs.writeFileSync(path.join(dir, "T44 clip other.eng.srt"), "");
  assert.equal(textSidecarBeside(video), null);
  fs.writeFileSync(path.join(dir, "T44 clip.eng.srt"), "");
  assert.equal(textSidecarBeside(video), "T44 clip.eng.srt");
});
