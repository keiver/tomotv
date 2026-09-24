/**
 * Mapping AVPlayer's positional audio indices onto Jellyfin stream indices, and what a
 * track report means. Drives the real orderAudioTracks/planAudioReport.
 */
import { chosenAudioLanguage, isFreshManifestReport, orderAudioTracks, planAudioReport, serverLaneCarriesEveryTrack, type AudioReportInput } from "../videoPlayback/audioTracks";

const report = (overrides: Partial<AudioReportInput> = {}): AudioReportInput => ({
  tracks: [],
  mapping: [],
  viewerPickedStreamIndex: null,
  lastSelectedIndex: null,
  freshManifest: false,
  stablePlayback: true,
  seamless: false,
  preferredLanguage: null,
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

describe("isFreshManifestReport", () => {
  it("keeps the viewer's track when an empty report arrives before the rebuilt stream's first real one", () => {
    // A rebuild moved the stream to generation 5; the viewer had picked Jellyfin stream 2 (position 1).
    let reported = 4;
    const empty = isFreshManifestReport(0, reported, 5);
    expect(empty).toBe(false);
    // The hook records a generation only for a report with tracks, so the next one is still the first.
    const fresh = isFreshManifestReport(2, reported, 5);
    expect(fresh).toBe(true);
    reported = 5;
    const plan = planAudioReport(report({ tracks: [track(0, true), track(1)], mapping: [1, 2], viewerPickedStreamIndex: 2, lastSelectedIndex: 1, freshManifest: fresh, seamless: true }));
    expect(plan.reapplyPosition).toBe(1);
    expect(plan.recordStreamIndex).toBeNull();
    expect(isFreshManifestReport(2, reported, 5)).toBe(false);
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
    const plan = planAudioReport(report({ tracks: [track(0, true), track(1)], mapping: [1, 2], viewerPickedStreamIndex: 2, freshManifest: true }));
    expect(plan.reapplyPosition).toBe(1);
  });

  it("re-applies on a fresh manifest whatever the last-selected ref still holds from the stream before", () => {
    // A rebuild's first report can land before the ref is cleared, and a restart parks a Jellyfin index in it.
    const plan = planAudioReport(report({ tracks: [track(0, true), track(1)], mapping: [1, 2], viewerPickedStreamIndex: 2, lastSelectedIndex: 2, freshManifest: true, seamless: true }));
    expect(plan).toMatchObject({ reapplyPosition: 1, recordStreamIndex: null, restartStreamIndex: null, setLastSelectedIndex: 0 });
  });

  it("never pushes the viewer back when they move on a manifest already playing", () => {
    // Picked stream 2 earlier, now moves to position 0: the report is the move, not a default to undo.
    const moved = planAudioReport(report({ tracks: [track(0, true), track(1)], mapping: [1, 2], viewerPickedStreamIndex: 2, lastSelectedIndex: 1, seamless: true }));
    expect(moved).toMatchObject({ reapplyPosition: null, recordStreamIndex: 1, setLastSelectedIndex: 0 });
    // And back again: each report records the new pick, none re-applies the old one.
    const back = planAudioReport(report({ tracks: [track(0), track(1, true)], mapping: [1, 2], viewerPickedStreamIndex: 1, lastSelectedIndex: 0, seamless: true }));
    expect(back).toMatchObject({ reapplyPosition: null, recordStreamIndex: 2, setLastSelectedIndex: 1 });
  });

  it("re-applies nothing when the viewer's track is already the one selected", () => {
    const plan = planAudioReport(report({ tracks: [track(0), track(1, true)], mapping: [1, 2], viewerPickedStreamIndex: 2, lastSelectedIndex: 1 }));
    expect(plan.reapplyPosition).toBeNull();
  });

  it("re-applies nothing when the fresh manifest carries only one track", () => {
    const plan = planAudioReport(report({ tracks: [track(0, true)], mapping: [1, 2], viewerPickedStreamIndex: 2, freshManifest: true }));
    expect(plan.reapplyPosition).toBeNull();
  });

  it("does nothing at all for a report with no selection", () => {
    const plan = planAudioReport(report({ tracks: [track(0), track(1)], mapping: [1, 2], lastSelectedIndex: 0 }));
    expect(plan).toMatchObject({ restartStreamIndex: null, recordStreamIndex: null, setLastSelectedIndex: null, reapplyPosition: null });
  });
});

describe("serverLaneCarriesEveryTrack", () => {
  const lane = { live: false, hdrSource: false, loaderAvailable: true, multiTrack: true };

  it("carries every track of a multi-track file, whether or not the viewer has picked one", () => {
    // The input has no field for a viewer's pick: a hand-over after a pick keeps the whole list.
    expect(serverLaneCarriesEveryTrack(lane)).toBe(true);
  });

  it("falls to the single track for a live channel, an HDR source, a missing loader or a lone track", () => {
    expect(serverLaneCarriesEveryTrack({ ...lane, live: true })).toBe(false);
    expect(serverLaneCarriesEveryTrack({ ...lane, hdrSource: true })).toBe(false);
    expect(serverLaneCarriesEveryTrack({ ...lane, loaderAvailable: false })).toBe(false);
    expect(serverLaneCarriesEveryTrack({ ...lane, multiTrack: false })).toBe(false);
  });
});

describe("remembered audio language", () => {
  // Direct play has no mapping: AVFoundation's own tags are all there is ("en", "ja" in an MP4).
  const mp4 = [
    { index: 0, selected: true, language: "en" },
    { index: 1, selected: false, language: "ja" },
  ];

  it("selects the remembered language by the report's tags on direct play's first report", () => {
    expect(planAudioReport(report({ tracks: mp4, freshManifest: true, stablePlayback: false, preferredLanguage: "ja" })).reapplyPosition).toBe(1);
  });

  it("does nothing on direct play when the item lacks the language or it is already playing", () => {
    expect(planAudioReport(report({ tracks: mp4, freshManifest: true, preferredLanguage: "fr" })).reapplyPosition).toBeNull();
    expect(planAudioReport(report({ tracks: mp4, freshManifest: true, preferredLanguage: "en" })).reapplyPosition).toBeNull();
  });

  it("leaves a later report alone, which is the viewer moving", () => {
    expect(planAudioReport(report({ tracks: mp4, freshManifest: false, lastSelectedIndex: 0, preferredLanguage: "ja" })).reapplyPosition).toBeNull();
  });

  it("goes by the mapping, not the language, where a mapping exists", () => {
    const engine = [
      { index: 0, selected: true, language: "eng" },
      { index: 1, selected: false, language: "jpn" },
    ];
    expect(planAudioReport(report({ tracks: engine, mapping: [1, 2], freshManifest: true, preferredLanguage: "ja" })).reapplyPosition).toBeNull();
  });

  it("names the position the viewer moved to during stable playback", () => {
    const moved = [track(0), track(1, true)];
    expect(planAudioReport(report({ tracks: moved, mapping: [1, 2], lastSelectedIndex: 0, seamless: true })).viewerChosePosition).toBe(1);
    expect(planAudioReport(report({ tracks: moved, mapping: [1, 2], lastSelectedIndex: 0 })).viewerChosePosition).toBe(1);
    expect(planAudioReport(report({ tracks: moved, lastSelectedIndex: 0 })).viewerChosePosition).toBe(1);
  });

  it("names nothing for the player's own selection", () => {
    const moved = [track(0), track(1, true)];
    expect(planAudioReport(report({ tracks: moved, mapping: [1, 2], lastSelectedIndex: 0, stablePlayback: false, seamless: true })).viewerChosePosition).toBeNull();
    expect(planAudioReport(report({ tracks: moved, mapping: [1, 2], lastSelectedIndex: 0, freshManifest: true, seamless: true })).viewerChosePosition).toBeNull();
    expect(planAudioReport(report({ tracks: moved, mapping: [1, 2], lastSelectedIndex: 1, seamless: true })).viewerChosePosition).toBeNull();
  });

  it("reads the chosen language from Jellyfin where mapped, else from the report", () => {
    const streams = [
      { Index: 1, Language: "eng" },
      { Index: 2, Language: "jpn" },
    ];
    expect(chosenAudioLanguage({ position: 0, mapping: [2, 1], streams, reported: [] })).toBe("jpn");
    expect(chosenAudioLanguage({ position: 1, mapping: [], streams, reported: [{ index: 1, language: "ja" }] })).toBe("ja");
    expect(chosenAudioLanguage({ position: 5, mapping: [], streams, reported: [] })).toBeNull();
  });
});
