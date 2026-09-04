import { clearResumeCache, getResumeOverrides, markResumePosition } from "@/services/resumeCache";

describe("resumeCache", () => {
  beforeEach(() => {
    clearResumeCache();
  });

  it("starts empty", () => {
    expect(getResumeOverrides().size).toBe(0);
  });

  it("markResumePosition records the latest ticks, including a clear to 0", () => {
    markResumePosition("x", 500);
    expect(getResumeOverrides().get("x")).toBe(500);
    markResumePosition("x", 0);
    expect(getResumeOverrides().get("x")).toBe(0);
  });

  it("holds only explicitly changed items (delta map, no seeding)", () => {
    markResumePosition("a", 1);
    expect(getResumeOverrides().has("b")).toBe(false);
    expect(getResumeOverrides().size).toBe(1);
  });

  it("clearResumeCache empties the map", () => {
    markResumePosition("a", 1);
    clearResumeCache();
    expect(getResumeOverrides().size).toBe(0);
  });
});
