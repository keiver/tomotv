import { carriedRungs, FLOOR_INDEX, linkCarriesPreset, ORIGINAL_INDEX, pickStartupIndex, presetNeedsMbps } from "../adaptiveQuality";

describe("pickStartupIndex", () => {
  it("opens at the floor when no measurement exists", () => {
    expect(pickStartupIndex(null, ORIGINAL_INDEX, 5_000_000)).toBe(FLOOR_INDEX);
    expect(pickStartupIndex(null, 2, null)).toBe(FLOOR_INDEX);
  });

  it("keeps Original when the link carries the SOURCE bitrate at 70% trust", () => {
    // 20 Mbps source over a 30 Mbps link: 0.7*30 = 21 >= 20 → stream copy stays.
    expect(pickStartupIndex(30_000_000, ORIGINAL_INDEX, 20_000_000)).toBe(ORIGINAL_INDEX);
    // Same link, 25 Mbps source: 21 < 25 → capped preset instead.
    expect(pickStartupIndex(30_000_000, ORIGINAL_INDEX, 25_000_000)).not.toBe(ORIGINAL_INDEX);
  });

  it("picks the highest capped preset the measurement clears at 70% trust", () => {
    // 0.7 * 13 Mbps = 9.1 Mbps → 1080p (8 Mbps), not 4K (20 Mbps).
    expect(pickStartupIndex(13_000_000, ORIGINAL_INDEX, 50_000_000)).toBe(3);
    // 0.7 * 3 Mbps = 2.1 Mbps → 480p (1.5 Mbps), not 540p (2.5 Mbps).
    expect(pickStartupIndex(3_000_000, ORIGINAL_INDEX, 50_000_000)).toBe(FLOOR_INDEX);
  });

  it("floors an unusably slow measurement", () => {
    expect(pickStartupIndex(100_000, ORIGINAL_INDEX, 50_000_000)).toBe(FLOOR_INDEX);
  });

  it("respects a pinned ceiling below Original", () => {
    // Fast link, but the session is pinned at 720p (index 2).
    expect(pickStartupIndex(100_000_000, 2, 5_000_000)).toBe(2);
  });
});

describe("linkCarriesPreset", () => {
  it("shares the startup trust rule with the settings capacity marks", () => {
    // 0.7 * 13 Mbps = 9.1 Mbps: carries 1080p (8 Mbps), not 4K (20 Mbps).
    expect(linkCarriesPreset(13_000_000, 3)).toBe(true);
    expect(linkCarriesPreset(13_000_000, 4)).toBe(false);
    expect(linkCarriesPreset(null, 0)).toBe(false);
  });
});

describe("carriedRungs", () => {
  it("counts the rungs the link clears, and agrees with the startup pick", () => {
    // 0.7 * 13 Mbps = 9.1 Mbps: 480p/540p/720p/1080p clear, 4K does not.
    expect(carriedRungs(13_000_000)).toBe(4);
    // The heading's ceiling and the player's entry preset are one index.
    expect(carriedRungs(13_000_000) - 1).toBe(pickStartupIndex(13_000_000, ORIGINAL_INDEX, null));
    expect(carriedRungs(1_000_000)).toBe(0);
    expect(carriedRungs(null)).toBe(0);
    expect(carriedRungs(1_000_000_000)).toBe(ORIGINAL_INDEX);
  });
});

describe("presetNeedsMbps", () => {
  it("states a threshold the gate actually honours at every rung", () => {
    for (let i = 0; i < ORIGINAL_INDEX; i++) {
      const shown = presetNeedsMbps(i);
      expect(linkCarriesPreset(shown * 1_000_000, i)).toBe(true);
      expect(linkCarriesPreset((shown - 1) * 1_000_000, i)).toBe(false);
    }
    expect(presetNeedsMbps(4)).toBe(29);
  });
});

describe("gatewayMaxBitRate", () => {
  const { gatewayMaxBitRate } = jest.requireActual<typeof import("../adaptiveQuality")>("../adaptiveQuality");

  it("caps a pinned preset at its bitrate (pins become seamless)", () => {
    expect(gatewayMaxBitRate({ mode: "fixed", bitrate: 8_000_000 })).toBe(8_000_000);
  });

  it("leaves Auto uncapped", () => {
    expect(gatewayMaxBitRate({ mode: "auto", bitrate: 120_000_000 })).toBeUndefined();
  });
});
