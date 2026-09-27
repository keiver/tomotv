import { cleanLabel } from "@/utils/cleanLabel";

describe("cleanLabel", () => {
  it("decodes HTML entities scrapers wrote into titles", () => {
    expect(cleanLabel("&quot;1 jikan buchinuki!&quot;")).toBe('"1 jikan buchinuki!"');
    expect(cleanLabel("Kokon musô! &quot;Hokage&quot;")).toBe('Kokon musô! "Hokage"');
    expect(cleanLabel("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(cleanLabel("It&#39;s Always Sunny")).toBe("It's Always Sunny");
  });

  it("returns plain text unchanged", () => {
    expect(cleanLabel("Naruto")).toBe("Naruto");
    expect(cleanLabel("Tom & Jerry")).toBe("Tom & Jerry");
    expect(cleanLabel("I <3 You")).toBe("I <3 You");
  });

  it("strips tags, including ones that decode into markup", () => {
    expect(cleanLabel("<b>Bold</b> Title")).toBe("Bold Title");
    expect(cleanLabel("&lt;b&gt;Bold&lt;/b&gt; Title")).toBe("Bold Title");
    expect(cleanLabel("&lt;script&gt;alert(1)&lt;/script&gt;x")).toBe("alert(1)x");
  });

  it("maps nullish to the empty string", () => {
    expect(cleanLabel(null)).toBe("");
    expect(cleanLabel(undefined)).toBe("");
    expect(cleanLabel("")).toBe("");
  });
});
