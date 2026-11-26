import { fillScale, keyRemoteZoom, nextRemoteZoom, pinchRestFit } from "@/components/page-viewer";

describe("keyRemoteZoom", () => {
  it("Up steps whole, fill, 2x, 3x and stays at 3x", () => {
    expect(keyRemoteZoom("whole", 1, 2, 1)).toEqual({ fit: "fill", level: 1 });
    expect(keyRemoteZoom("fill", 1, 2, 1)).toEqual({ fit: "fill", level: 2 });
    expect(keyRemoteZoom("fill", 2, 2, 1)).toEqual({ fit: "fill", level: 3 });
    expect(keyRemoteZoom("fill", 3, 2, 1)).toEqual({ fit: "fill", level: 3 });
  });

  it("Down steps 3x, 2x, fill, whole and stays at whole", () => {
    expect(keyRemoteZoom("fill", 3, 2, -1)).toEqual({ fit: "fill", level: 2 });
    expect(keyRemoteZoom("fill", 2, 2, -1)).toEqual({ fit: "fill", level: 1 });
    expect(keyRemoteZoom("fill", 1, 2, -1)).toEqual({ fit: "whole", level: 1 });
    expect(keyRemoteZoom("whole", 1, 2, -1)).toEqual({ fit: "whole", level: 1 });
  });

  it("Up skips fill for a page that already covers the screen", () => {
    expect(keyRemoteZoom("whole", 1, 1, 1)).toEqual({ fit: "whole", level: 2 });
  });
});

describe("fillScale", () => {
  it("is the scale that makes a page drawn whole cover the screen, on either axis", () => {
    expect(fillScale(4 / 3, 16 / 9)).toBeCloseTo(4 / 3);
    expect(fillScale(3, 0.5)).toBeCloseTo(6);
    expect(fillScale(0.75, 16 / 9)).toBeCloseTo(64 / 27);
    expect(fillScale(16 / 9, 16 / 9)).toBe(1);
  });

  it("is 1 with no page shape or no screen shape", () => {
    expect(fillScale(undefined, 16 / 9)).toBe(1);
    expect(fillScale(0, 16 / 9)).toBe(1);
    expect(fillScale(1.5, 0)).toBe(1);
  });
});

describe("pinchRestFit", () => {
  it("a pinch in from whole that ends near the fill scale rests at fill", () => {
    expect(pinchRestFit("whole", 2, 2)).toBe("fill");
    expect(pinchRestFit("whole", 1.9, 2)).toBe("fill");
    expect(pinchRestFit("whole", 2.1, 2)).toBe("fill");
  });

  it("a pinch in from whole that ends anywhere else changes nothing", () => {
    expect(pinchRestFit("whole", 1.5, 2)).toBeNull();
    expect(pinchRestFit("whole", 3, 2)).toBeNull();
    expect(pinchRestFit("whole", 1, 2)).toBeNull();
  });

  it("a pinch that ends at 1x never switches a whole page to fill, however close its fill scale is to 1", () => {
    expect(pinchRestFit("whole", 1, 1.05)).toBeNull();
    expect(pinchRestFit("whole", 1, 1.08)).toBeNull();
    expect(pinchRestFit("whole", 1.05, 1.05)).toBe("fill");
  });

  it("a pinch out of fill that ends under 0.9x rests whole, and one that ends at 0.9x or above changes nothing", () => {
    expect(pinchRestFit("fill", 0.6, 2)).toBe("whole");
    expect(pinchRestFit("fill", 0.89, 2)).toBe("whole");
    expect(pinchRestFit("fill", 0.95, 2)).toBeNull();
    expect(pinchRestFit("fill", 2, 2)).toBeNull();
  });

  it("a page whose fill scale is 1.1 rests whole once a pinch out ends under the midpoint between fill and whole", () => {
    expect(pinchRestFit("fill", 0.96, 1.1)).toBeNull();
    expect(pinchRestFit("fill", 0.93, 1.1)).toBe("whole");
  });

  it("a page that already covers the screen never changes the resting fit", () => {
    expect(pinchRestFit("whole", 1, 1)).toBeNull();
    expect(pinchRestFit("fill", 0.99, 1.01)).toBeNull();
  });
});

describe("nextRemoteZoom", () => {
  it("steps whole, fill, 2x, 3x, then whole again", () => {
    expect(nextRemoteZoom("whole", 1, 2)).toEqual({ fit: "fill", level: 1 });
    expect(nextRemoteZoom("fill", 1, 2)).toEqual({ fit: "fill", level: 2 });
    expect(nextRemoteZoom("fill", 2, 2)).toEqual({ fit: "fill", level: 3 });
    expect(nextRemoteZoom("fill", 3, 2)).toEqual({ fit: "whole", level: 1 });
  });

  it("skips fill for a page that already covers the screen", () => {
    expect(nextRemoteZoom("whole", 1, 1)).toEqual({ fit: "whole", level: 2 });
    expect(nextRemoteZoom("whole", 2, 1)).toEqual({ fit: "whole", level: 3 });
    expect(nextRemoteZoom("whole", 3, 1)).toEqual({ fit: "whole", level: 1 });
  });
});
