import { isDemoAddress } from "@/services/jellyfin/demo";

describe("isDemoAddress", () => {
  it("matches the demo address however it is typed", () => {
    expect(isDemoAddress("tomotv.cubita.studio")).toBe(true);
    expect(isDemoAddress("https://tomotv.cubita.studio/")).toBe(true);
    expect(isDemoAddress("  HTTP://TomoTV.Cubita.Studio ")).toBe(true);
  });

  it("leaves other addresses to the normal flow", () => {
    expect(isDemoAddress("")).toBe(false);
    expect(isDemoAddress("cubita.studio")).toBe(false);
    expect(isDemoAddress("demo.jellyfin.org/stable")).toBe(false);
    expect(isDemoAddress("192.168.40.89:8096")).toBe(false);
  });
});
