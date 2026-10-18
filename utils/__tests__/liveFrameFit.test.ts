import { liveFrameBox, livePictureAspect, rememberLivePictureAspect } from "../liveFrameFit";

const WIDE = 16 / 9;

describe("liveFrameBox", () => {
  it("fills the card with a 16:9 picture or an unmeasured one", () => {
    expect(liveFrameBox(16 / 9, WIDE)).toBeNull();
    expect(liveFrameBox(undefined, WIDE)).toBeNull();
    expect(liveFrameBox(0, WIDE)).toBeNull();
  });

  it("fills the card when the crop stays inside 3.5% a side", () => {
    // 16:10 would lose 5% top and bottom; 1.85:1 loses 1.95% a side.
    expect(liveFrameBox(16 / 10, WIDE)).not.toBeNull();
    expect(liveFrameBox(1.85, WIDE)).toBeNull();
    expect(liveFrameBox(1.7, WIDE)).toBeNull();
  });

  it("shows a 4:3 picture whole, centred, full height", () => {
    expect(liveFrameBox(4 / 3, WIDE)).toEqual({ position: "absolute", left: "12.5%", top: "0%", width: "75%", height: "100%" });
  });

  it("shows a wider picture whole, centred, full width", () => {
    const box = liveFrameBox(2.39, WIDE);
    expect(box).toMatchObject({ left: "0%", width: "100%" });
    expect(parseFloat(String(box?.height))).toBeCloseTo((WIDE / 2.39) * 100, 5);
    expect(parseFloat(String(box?.top))).toBeCloseTo(((1 - WIDE / 2.39) / 2) * 100, 5);
  });
});

describe("live picture aspect", () => {
  it("remembers the last shape per channel", () => {
    expect(livePictureAspect("c-new")).toBeUndefined();
    rememberLivePictureAspect("c-new", 4 / 3);
    expect(livePictureAspect("c-new")).toBe(4 / 3);
  });
});
