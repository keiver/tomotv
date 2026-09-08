import { buildJoinLink, joinQrDataUri } from "@/components/join-qr";

describe("buildJoinLink", () => {
  it("encodes server and group into the deep link, no credentials", () => {
    const link = buildJoinLink("srv-1", "grp-9");
    expect(link).toBe("tomotv:///watch-together?serverId=srv-1&groupId=grp-9");
    expect(link).not.toMatch(/token|api_key|password/i);
  });

  it("url-encodes ids with unsafe characters", () => {
    expect(buildJoinLink("a b", "x&y")).toBe("tomotv:///watch-together?serverId=a%20b&groupId=x%26y");
  });
});

describe("joinQrDataUri", () => {
  it("encodes a transparent PNG for a realistic join link", () => {
    const uri = joinQrDataUri("25d3375e3ac441e4b67b662ac14865c9", "6f1e2d3c4b5a69788796a5b4c3d2e1f0");
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
    expect(uri.length).toBeGreaterThan(1000);
  });

  it("returns the same cached image for the same group", () => {
    const a = joinQrDataUri("srv", "grp");
    const b = joinQrDataUri("srv", "grp");
    expect(a).toBe(b);
    expect(joinQrDataUri("srv", "other")).not.toBe(a);
  });
});
