import assert from "node:assert/strict";
import { test } from "node:test";
import { inSourceOrder, sourceOrderAudioIndex } from "../playback-regression.mjs";

const stereo = { action: "copy", active: true, source: { channels: 2, layout: "stereo" }, streamIndex: 1 };
const commentary = { action: "copy", active: true, source: { channels: 1, layout: "mono" }, streamIndex: 8 };

function record(first, second) {
  return {
    streams: { audio: ["aac", "aac"], audioDetail: [first.source, second.source] },
    enginePlan: {
      audio: [
        { ...first, rendition: "a0" },
        { ...second, rendition: "a1" },
      ],
      video: { action: "copy" },
    },
  };
}

test("the audio hashed is the file's first audio stream when the engine lists it first", () => {
  assert.equal(sourceOrderAudioIndex(record(stereo, commentary).enginePlan.audio), 0);
});

test("the audio hashed is the file's first audio stream when a preferred language puts another track first", () => {
  assert.equal(sourceOrderAudioIndex(record(commentary, stereo).enginePlan.audio), 1);
});

test("a single audio track, or no engine plan, hashes the first audio stream", () => {
  assert.equal(sourceOrderAudioIndex([{ ...stereo, rendition: "a0" }]), 0);
  assert.equal(sourceOrderAudioIndex(undefined), 0);
});

test("a baseline compares equal whichever track the account's language puts first", () => {
  assert.deepEqual(inSourceOrder(record(commentary, stereo)), inSourceOrder(record(stereo, commentary)));
});

test("a change in what the engine does with a track still differs", () => {
  const encoded = { ...commentary, action: "encode" };
  assert.notDeepEqual(inSourceOrder(record(encoded, stereo)), inSourceOrder(record(stereo, commentary)));
});
