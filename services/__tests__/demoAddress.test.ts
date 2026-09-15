import { isDemoAddress } from "@/services/jellyfin/demo";

describe("isDemoAddress", () => {
  it("matches the demo address however it is typed", () => {
    expect(isDemoAddress("demo.jellyfin.org/stable")).toBe(true);
    expect(isDemoAddress("https://demo.jellyfin.org/stable/")).toBe(true);
    expect(isDemoAddress("  HTTP://Demo.Jellyfin.org/stable ")).toBe(true);
  });

  it("leaves other addresses to the normal flow", () => {
    expect(isDemoAddress("")).toBe(false);
    expect(isDemoAddress("demo.jellyfin.org")).toBe(false);
    expect(isDemoAddress("192.168.40.89:8096")).toBe(false);
  });
});
