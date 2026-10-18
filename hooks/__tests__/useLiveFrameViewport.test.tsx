/** useLiveFrameViewport: the rows in view (plus one lookahead on a phone) reach the sampler on its surface, active with the screen, cleared on unmount; on TV the rows partly on screen are reported behind them. */
import { partlyShownChannelIds, useLiveFrameViewport, viewportChannelIds, type LiveFrameViewabilityPair } from "@/hooks/useLiveFrameViewport";
import { setLiveFramesActive, setLiveFrameViewable } from "@/services/liveFrames";
import React, { forwardRef, useImperativeHandle } from "react";
import type { ViewToken } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

let mockFocused = true;
jest.mock("expo-router", () => ({ useIsFocused: () => mockFocused }));
jest.mock("@/services/liveFrames", () => ({ setLiveFramesActive: jest.fn(), setLiveFrameViewable: jest.fn() }));

const mockActive = setLiveFramesActive as jest.Mock;
const mockViewable = setLiveFrameViewable as jest.Mock;

type Row = { ids: string[] };
const idsOf = (row: Row) => row.ids;
const token = (item: Row, index: number, isViewable = true): ViewToken<Row> => ({ item, index, isViewable, key: String(index) });

type Handle = { pairs: LiveFrameViewabilityPair<Row>[]; report: (viewableItems: ViewToken<Row>[]) => void; visible: ReadonlySet<string> };
const Probe = forwardRef<Handle, { rows: Row[]; enabled: boolean }>(({ rows, enabled }, ref) => {
  const { viewabilityPairs, visibleChannelIds } = useLiveFrameViewport("wall", enabled, rows, idsOf);
  useImperativeHandle(ref, () => ({ pairs: viewabilityPairs, report: (viewableItems) => viewabilityPairs[0].onViewableItemsChanged({ viewableItems }), visible: visibleChannelIds }), [
    viewabilityPairs,
    visibleChannelIds,
  ]);
  return null;
});
Probe.displayName = "Probe";

describe("viewportChannelIds", () => {
  it("flattens the rows in view in order and adds the row after the last one", () => {
    const rows: Row[] = [{ ids: ["a", "b"] }, { ids: ["c"] }, { ids: ["d", "e"] }, { ids: ["f"] }];
    expect(viewportChannelIds([token(rows[0], 0), token(rows[1], 1)], rows, idsOf)).toEqual(["a", "b", "c", "d", "e"]);
    expect(viewportChannelIds([token(rows[2], 2, false), token(rows[3], 3)], rows, idsOf)).toEqual(["f"]);
    expect(viewportChannelIds([], rows, idsOf)).toEqual([]);
  });

  it("on TV counts only a row wholly on screen and adds no row after the last one", () => {
    const rows: Row[] = [{ ids: ["a", "b"] }, { ids: ["c"] }, { ids: ["d", "e"] }];
    jest.isolateModules(() => {
      const { Platform } = require("react-native") as { Platform: { isTV: boolean } };
      Object.defineProperty(Platform, "isTV", { configurable: true, value: true });
      const tv = require("@/hooks/useLiveFrameViewport") as typeof import("@/hooks/useLiveFrameViewport");
      expect(tv.LIVE_FRAME_VIEWABILITY).toEqual({ itemVisiblePercentThreshold: 100, minimumViewTime: 300 });
      expect(tv.viewportChannelIds([token(rows[0], 0), token(rows[1], 1)], rows, idsOf)).toEqual(["a", "b", "c"]);
      Object.defineProperty(Platform, "isTV", { configurable: true, value: false });
    });
    expect(viewportChannelIds([token(rows[0], 0)], rows, idsOf, false)).toEqual(["a", "b"]);
  });

  it("names the rows past the part threshold that are not wholly on screen, with no row read ahead", () => {
    const rows: Row[] = [{ ids: ["a"] }, { ids: ["b", "c"] }, { ids: ["d"] }, { ids: ["e"] }];
    const part = [token(rows[0], 0), token(rows[1], 1), token(rows[2], 2), token(rows[3], 3, false)];
    // On a phone the lookahead row counts among the whole rows, so "d" is not partly shown here.
    expect(partlyShownChannelIds([token(rows[1], 1)], part, rows, idsOf)).toEqual(["a"]);
    expect(partlyShownChannelIds([], part, rows, idsOf)).toEqual(["a", "b", "c", "d"]);
    expect(partlyShownChannelIds([token(rows[1], 1)], [], rows, idsOf)).toEqual([]);
  });
});

describe("useLiveFrameViewport", () => {
  beforeEach(() => {
    mockFocused = true;
    mockActive.mockClear();
    mockViewable.mockClear();
  });

  it("follows the screen's focus, reports the rows in view off the latest list, and clears on unmount", () => {
    const rows: Row[] = [{ ids: ["a"] }, { ids: ["b"] }];
    const ref = React.createRef<Handle>();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Probe ref={ref} rows={rows} enabled />);
    });
    expect(mockActive).toHaveBeenLastCalledWith("wall", true);
    // A phone counts any visible pixel, so it has no second pair for the rows partly on screen.
    expect(ref.current!.pairs).toHaveLength(1);

    act(() => ref.current?.report([token(rows[0], 0)]));
    expect(mockViewable).toHaveBeenLastCalledWith("wall", ["a", "b"], []);
    expect([...ref.current!.visible]).toEqual(["a"]);

    const grown = rows.concat({ ids: ["c"] });
    act(() => renderer.update(<Probe ref={ref} rows={grown} enabled />));
    act(() => ref.current?.report([token(grown[1], 1)]));
    expect(mockViewable).toHaveBeenLastCalledWith("wall", ["b", "c"], []);
    expect([...ref.current!.visible]).toEqual(["b"]);

    mockFocused = false;
    act(() => renderer.update(<Probe ref={ref} rows={grown} enabled />));
    expect(mockActive).toHaveBeenLastCalledWith("wall", false);
    expect([...ref.current!.visible]).toEqual([]);

    act(() => renderer.unmount());
    expect(mockViewable).toHaveBeenLastCalledWith("wall", []);
  });

  it("keeps reporting the rows while disabled, so turning the setting on activates with the rows in view", () => {
    const rows: Row[] = [{ ids: ["a"] }];
    const ref = React.createRef<Handle>();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Probe ref={ref} rows={rows} enabled={false} />);
    });
    act(() => ref.current?.report([token(rows[0], 0)]));
    expect(mockActive).not.toHaveBeenCalled();
    expect(mockViewable).toHaveBeenLastCalledWith("wall", ["a"], []);

    act(() => renderer.update(<Probe ref={ref} rows={rows} enabled />));
    expect(mockActive).toHaveBeenLastCalledWith("wall", true);

    act(() => renderer.update(<Probe ref={ref} rows={rows} enabled={false} />));
    expect(mockActive).toHaveBeenLastCalledWith("wall", false);
    act(() => renderer.unmount());
    expect(mockViewable).toHaveBeenLastCalledWith("wall", []);
  });

  it("on TV reports the rows past the part threshold behind the whole rows, and only the whole rows play clips", () => {
    jest.isolateModules(() => {
      const { Platform } = require("react-native") as { Platform: { isTV: boolean } };
      Object.defineProperty(Platform, "isTV", { configurable: true, value: true });
      const tv = require("@/hooks/useLiveFrameViewport") as typeof import("@/hooks/useLiveFrameViewport");
      const services = require("@/services/liveFrames") as { setLiveFrameViewable: jest.Mock };
      const TvReact = require("react") as typeof React;
      const TvRenderer = require("react-test-renderer") as typeof TestRenderer;
      const rows: Row[] = [{ ids: ["a"] }, { ids: ["b", "c"] }, { ids: ["d"] }];
      let pairs: LiveFrameViewabilityPair<Row>[] = [];
      let visible: ReadonlySet<string> = new Set();
      const TvProbe = () => {
        const got = tv.useLiveFrameViewport("guide", true, rows, idsOf);
        pairs = got.viewabilityPairs;
        visible = got.visibleChannelIds;
        return null;
      };
      let renderer!: TestRenderer.ReactTestRenderer;
      TvRenderer.act(() => {
        renderer = TvRenderer.create(TvReact.createElement(TvProbe));
      });
      expect(pairs.map((pair) => pair.viewabilityConfig)).toEqual([tv.LIVE_FRAME_VIEWABILITY, tv.LIVE_FRAME_PART_VIEWABILITY]);
      expect(tv.LIVE_FRAME_PART_VIEWABILITY).toEqual({ itemVisiblePercentThreshold: 15, minimumViewTime: 300 });

      TvRenderer.act(() => pairs[1].onViewableItemsChanged({ viewableItems: [token(rows[0], 0), token(rows[1], 1), token(rows[2], 2)] }));
      expect(services.setLiveFrameViewable).toHaveBeenLastCalledWith("guide", [], ["a", "b", "c", "d"]);
      TvRenderer.act(() => pairs[0].onViewableItemsChanged({ viewableItems: [token(rows[1], 1)] }));
      expect(services.setLiveFrameViewable).toHaveBeenLastCalledWith("guide", ["b", "c"], ["a", "d"]);
      expect([...visible]).toEqual(["b", "c"]);
      // The last row scrolls off past the part threshold: it leaves both lists.
      TvRenderer.act(() => pairs[1].onViewableItemsChanged({ viewableItems: [token(rows[0], 0), token(rows[1], 1), token(rows[2], 2, false)] }));
      expect(services.setLiveFrameViewable).toHaveBeenLastCalledWith("guide", ["b", "c"], ["a"]);

      TvRenderer.act(() => renderer.unmount());
      Object.defineProperty(Platform, "isTV", { configurable: true, value: false });
    });
  });
});
