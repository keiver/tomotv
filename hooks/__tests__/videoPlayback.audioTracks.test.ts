/**
 * Mapping AVPlayer's positional audio indices onto Jellyfin stream indices, and what a
 * track report means. Drives the real orderAudioTracks/planAudioReport.
 */
import { orderAudioTracks, planAudioReport, type AudioReportInput } from "../videoPlayback/audioTracks";

const report = (overrides: Partial<AudioReportInput> = {}): AudioReportInput => ({
  tracks: [],
  mapping: [],
  viewerPickedStreamIndex: null,
  lastSelectedIndex: null,
  stablePlayback: true,
  seamless: false,
  ...overrides,
});

const track = (index: number, selected = false) => ({ index, selected });

describe("orderAudioTracks", () => {
  it("keeps the default-first order the loader handed the native side", () => {
    // English first because getAudioTracks sorted it there, not because 8 < 1.
    expect(orderAudioTracks([{ Index: 8 }, { Index: 1 }], null)).toEqual([8, 1]);
  });

  it("moves the playing track to position 0 for an engine rebuild", () => {
    expect(orderAudioTracks([{ Index: 1 }, { Index: 8 }, { Index: 9 }], 8)).toEqual([8, 1, 9]);
  });

  it("leaves the order alone when the preferred stream is not in the list", () => {
    expect(orderAudioTracks([{ Index: 1 }, { Index: 8 }], 99)).toEqual([1, 8]);
  });

  it("does not mutate the list it was given", () => {
    const tracks = [{ Index: 1 }, { Index: 8 }];
    orderAudioTracks(tracks, 8);
    expect(tracks).toEqual([{ Index: 1 }, { Index: 8 }]);
  });
});

describe("planAudioReport", () => {
  it("records the first selection without restarting anything", () => {
    const plan = planAudioReport(report({ tracks: [track(0, true), track(1)], mapping: [1, 2] }));
    expect(plan).toMatchObject({ restartStreamIndex: null, recordStreamIndex: null, setLastSelectedIndex: 0 });
  });

  it("restarts the server session on the Jellyfin stream the viewer picked", () => {
    const plan = planAudioReport(report({ tracks: [track(0), track(1, true)], mapping: [1, 2], lastSelectedIndex: 0 }));
    expect(plan.restartStreamIndex).toBe(2);
    // The ref parks the Jellyfin index during a restart, so a position must not overwrite it.
    expect(plan.setLastSelectedIndex).toBeNull();
  });

  it("only records a seamless switch: AVPlayer already swapped renditions", () => {
    const plan = planAudioReport(report({ tracks: [track(0), track(1, true)], mapping: [1, 2], lastSelectedIndex: 0, seamless: true }));
    expect(plan).toMatchObject({ restartStreamIndex: null, recordStreamIndex: 2, setLastSelectedIndex: 1 });
  });

  it("does not restart before playback is stable: that is automatic selection, not a viewer", () => {
    const plan = planAudioReport(report({ tracks: [track(0), track(1, true)], mapping: [1, 2], lastSelectedIndex: 0, stablePlayback: false }));
    expect(plan.restartStreamIndex).toBeNull();
    expect(plan.setLastSelectedIndex).toBe(1);
  });

  it("reports an unmapped position instead of restarting on a guess", () => {
    const plan = planAudioReport(report({ tracks: [track(0), track(3, true)], mapping: [1, 2], lastSelectedIndex: 0 }));
    expect(plan).toMatchObject({ unmapped: true, restartStreamIndex: null });
  });

  it("ignores a single-track manifest after a restart, which would otherwise loop forever", () => {
    // Jellyfin serves only the chosen track, so the position no longer means what it did.
    const plan = planAudioReport(report({ tracks: [track(0, true)], mapping: [1, 2], lastSelectedIndex: 2 }));
    expect(plan).toMatchObject({ restartStreamIndex: null, recordStreamIndex: null, setLastSelectedIndex: null });
  });

  it("re-applies the viewer's track by position when a rebuild opens a fresh manifest", () => {
    const plan = planAudioReport(report({ tracks: [track(0, true), track(1)], mapping: [1, 2], viewerPickedStreamIndex: 2 }));
    expect(plan.reapplyPosition).toBe(1);
  });

  it("re-applies nothing when the viewer's track is already the one selected", () => {
    const plan = planAudioReport(report({ tracks: [track(0), track(1, true)], mapping: [1, 2], viewerPickedStreamIndex: 2, lastSelectedIndex: 1 }));
    expect(plan.reapplyPosition).toBeNull();
  });

  it("re-applies nothing when the fresh manifest carries only one track", () => {
    const plan = planAudioReport(report({ tracks: [track(0, true)], mapping: [1, 2], viewerPickedStreamIndex: 2 }));
    expect(plan.reapplyPosition).toBeNull();
  });

  it("does nothing at all for a report with no selection", () => {
    const plan = planAudioReport(report({ tracks: [track(0), track(1)], mapping: [1, 2], lastSelectedIndex: 0 }));
    expect(plan).toMatchObject({ restartStreamIndex: null, recordStreamIndex: null, setLastSelectedIndex: null, reapplyPosition: null });
  });
});
