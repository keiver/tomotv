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
  const drag = async (translationX: number, translationY = 0) => {
    const onSettle = jest.fn();
    const columnW = shared(150);
    let seam!: { handlers: Record<string, PanHandler> };
    function Probe() {
      seam = useColumnResize({ columnW: columnW as never, canvasW: shared(400) as never, minWidth: 77, maxWidth: 150, initialCompact: false, onCompactChange: () => undefined, onSettle })
        .seam as never;
      return null;
    }
    await act(async () => {
      TestRenderer.create(<Probe />);
    });
    seam.handlers.begin();
    seam.handlers.update({ translationX, translationY });
    seam.handlers.finalize();
    return onSettle;
  };

  it("reports the magnet's width when a resize ends", async () => {
    expect(await drag(-30)).toHaveBeenCalledWith(77);
  });

  it("reports nothing for a slide along the seam", async () => {
    expect(await drag(0, 40)).not.toHaveBeenCalled();
  });
});
