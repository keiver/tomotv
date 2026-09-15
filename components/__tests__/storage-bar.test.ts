import { storageBarFill } from "@/components/storage-bar";

describe("storageBarFill", () => {
  it("is empty when nothing is downloaded", () => {
    expect(storageBarFill(0, 1000)).toEqual({ fraction: 0, percent: 0, accessibleNow: 0 });
  });

  it("guards against a zero total", () => {
    expect(storageBarFill(0, 0)).toEqual({ fraction: 0, percent: 0, accessibleNow: 0 });
  });

  it("floors a sliver so the bar still reads", () => {
    // 6% is MIN_VISIBLE_FRACTION, even though the true fraction rounds to nothing.
    const { percent, accessibleNow } = storageBarFill(1, 999999);
    expect(percent).toBeCloseTo(6);
    expect(accessibleNow).toBe(0);
  });

  it("passes a mid value straight through", () => {
    const { fraction, percent, accessibleNow } = storageBarFill(50, 50);
    expect(fraction).toBeCloseTo(0.5);
    expect(percent).toBeCloseTo(50);
    expect(accessibleNow).toBe(50);
  });

  it("clamps a full disk to 100", () => {
    expect(storageBarFill(100, 0).percent).toBe(100);
  });
});
