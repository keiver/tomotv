import { platformLabel } from "../hostEnvironment";

describe("platformLabel", () => {
  it("names tvOS ahead of everything", () => {
    expect(platformLabel(true, false, false, false)).toBe("tvOS");
  });

  it("splits the two Mac builds by isiOSAppOnMac", () => {
    expect(platformLabel(false, true, false, false)).toBe("Mac Catalyst");
    expect(platformLabel(false, true, true, true)).toBe("iPad on Mac");
  });

  it("splits phone and pad off the Mac path", () => {
    expect(platformLabel(false, false, false, true)).toBe("iPadOS");
    expect(platformLabel(false, false, false, false)).toBe("iOS");
  });
});
