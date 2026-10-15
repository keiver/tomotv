/** deviceDecodes for AV1: copy only Main profile, and only where the device has AV1 hardware. */
import { deviceDecodes, type VideoDecodeSupport } from "../src/codecs";

const device = (av1: boolean): VideoDecodeSupport => ({ hevc: true, hevcMain10: true, av1, h264MaxHeight: null, hevcMaxHeight: null });

describe("deviceDecodes for AV1", () => {
  it.each([
    { profile: "Main", bitDepth: 8 },
    { profile: "Main", bitDepth: 10 },
  ])("copies $profile $bitDepth-bit AV1 on AV1 hardware", ({ profile, bitDepth }) => {
    expect(deviceDecodes("av1", bitDepth, device(true), 2160, profile)).toBe(true);
  });

  it.each([
    { profile: "High", bitDepth: 10 },
    { profile: "Professional", bitDepth: 12 },
  ])("re-encodes $profile AV1 on the device even with AV1 hardware", ({ profile, bitDepth }) => {
    expect(deviceDecodes("av1", bitDepth, device(true), 1080, profile)).toBe(false);
  });

  it("re-encodes AV1 whose profile the server did not report", () => {
    expect(deviceDecodes("av1", 8, device(true), 1080)).toBe(false);
  });

  it("re-encodes Main AV1 on a device without AV1 hardware", () => {
    expect(deviceDecodes("av1", 8, device(false), 720, "Main")).toBe(false);
  });
});
