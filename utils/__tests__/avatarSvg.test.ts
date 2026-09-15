import { avatarFace, avatarSvg, avatarSvgDataUri } from "@/utils/avatarSvg";

const HEX = /^#[0-9A-F]{6}$/;

describe("avatarFace", () => {
  it("draws the same face for the same name, ignoring case and whitespace", () => {
    expect(avatarFace("probe")).toEqual(avatarFace(" Probe "));
  });

  it("draws different faces for different names", () => {
    expect(avatarFace("admin")).not.toEqual(avatarFace("demo"));
  });

  it("takes a dark ground and two distinct flat inks", () => {
    for (const seed of ["a", "probe", "applereview", "zzzzzzzz", "Ünïcode"]) {
      const { palette } = avatarFace(seed);
      expect(new Set(palette).size).toBe(3);
      expect(["#34495E", "#2C3E50"]).toContain(palette[0]);
      for (const hex of palette) expect(hex).toMatch(HEX);
    }
  });

  it("draws one upright head-over-shoulders geometry for every name", () => {
    for (const seed of ["a", "probe", "applereview", "zzzzzzzz", "Ünïcode", ...Array.from({ length: 200 }, (_, i) => `user${i}`)]) {
      const { bloom, glow } = avatarFace(seed);
      expect(bloom).toEqual({ cx: 50, cy: 80, r: 46 });
      expect(glow).toEqual({ cx: 50, cy: 30, r: 22 });
    }
  });
});

describe("avatarSvg", () => {
  it("is a ground with two flat discs and no text", () => {
    const svg = avatarSvg("probe");
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#')).toBe(true);
    expect(svg.match(/<circle cx="[\d.]+" cy="[\d.]+" r="(46|22)" fill="#[0-9A-F]{6}"\/>/g)).toHaveLength(2);
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("opacity");
  });

  it("wraps the markup as an svg+xml data URI", () => {
    const uri = avatarSvgDataUri("probe");
    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(decodeURIComponent(uri.slice("data:image/svg+xml;utf8,".length))).toBe(avatarSvg("probe"));
  });
});
