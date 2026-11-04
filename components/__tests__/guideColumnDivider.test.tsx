/** The seam grip: placed once where the thumb rests, then kept inside its band when a rotation shrinks it. */
import { GuideColumnDivider, useColumnResize } from "@/components/live-tv/guide-column-divider";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { View } from "react-native";

type PanHandler = (event?: { translationX: number; translationY: number }) => void;
jest.mock("react-native-gesture-handler", () => {
  const { View: RNView } = jest.requireActual("react-native");
  const Pan = () => {
    const handlers: Record<string, PanHandler> = {};
    const pan = {
      handlers,
      onBegin: (fn: PanHandler) => ((handlers.begin = fn), pan),
      onUpdate: (fn: PanHandler) => ((handlers.update = fn), pan),
      onFinalize: (fn: PanHandler) => ((handlers.finalize = fn), pan),
    };
    return pan;
  };
  return {
    GestureHandlerRootView: RNView,
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    Gesture: { Pan },
  };
});
jest.mock("@/components/live-tv/guide-grip", () => ({ GuideGrip: () => null }));

const shared = (initial: number) => {
  let value = initial;
  return { get: () => value, set: (next: number) => (value = next), value };
};

describe("GuideColumnDivider", () => {
  it("clamps the grip back inside a band that shrank", async () => {
    const gripY = shared(0);
    const bandH = shared(0);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<GuideColumnDivider columnW={shared(200) as never} topInset={0} bottomInset={0} gesture={{} as never} gripY={gripY as never} bandH={bandH as never} />);
    });
    const band = renderer.root.findAll((node) => node.type === View && typeof node.props.onLayout === "function")[0];
    await act(async () => band.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 48, height: 800 } } }));
    // A drag left the grip low in the tall portrait band.
    gripY.set(360);
    await act(async () => band.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 48, height: 300 } } }));
    expect(bandH.get()).toBe(300);
    expect(gripY.get()).toBe((300 - 64) / 2);
  });
});

describe("useColumnResize", () => {
  const drag = async (translationX: number, translationY = 0, velocityX = 0) => {
    const onSettle = jest.fn();
    lastRest.mockClear();
    const columnW = shared(176);
    let seam!: { handlers: Record<string, PanHandler> };
    function Probe() {
      seam = useColumnResize({ columnW: columnW as never, canvasW: shared(400) as never, minWidth: 74, defaultWidth: 176, onSettle, onRest: lastRest }).seam as never;
      return null;
    }
    await act(async () => {
      TestRenderer.create(<Probe />);
    });
    seam.handlers.begin();
    seam.handlers.update({ translationX, translationY });
    (seam.handlers.finalize as unknown as (event: { velocityX: number }) => void)({ velocityX });
    return onSettle;
  };
  const lastRest = jest.fn();

  it("settles on the closed stop when let go nearer the logo width", async () => {
    expect(await drag(-80)).toHaveBeenCalledWith("closed", 74);
  });

  it("settles on the wide stop, 240pt, when let go nearer it", async () => {
    expect(await drag(50)).toHaveBeenCalledWith("wide", 240);
  });

  it("follows a fling to the next stop even when let go nearer the last one", async () => {
    expect(await drag(10, 0, 1500)).toHaveBeenCalledWith("wide", 240);
  });

  it("lays the lists out at the new width only once the column has sprung to rest there", async () => {
    const reanimated = jest.requireMock("react-native-reanimated") as { withSpring: (to: number, config: unknown, done?: (finished: boolean) => void) => number };
    const spring = reanimated.withSpring;
    const landings: ((finished: boolean) => void)[] = [];
    reanimated.withSpring = (to, _config, done) => {
      if (done) landings.push(done);
      return to;
    };
    try {
      await drag(50);
      expect(lastRest).not.toHaveBeenCalled();
      landings.forEach((land) => land(true));
      expect(lastRest).toHaveBeenCalledWith(240);
    } finally {
      reanimated.withSpring = spring;
    }
  });

  it("reports nothing for a slide along the seam", async () => {
    expect(await drag(0, 40)).not.toHaveBeenCalled();
  });
});
