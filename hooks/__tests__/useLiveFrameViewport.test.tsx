/** useLiveFrameViewport: the rows in view plus one lookahead reach the sampler on its surface, active with the screen, cleared on unmount. */
import { useLiveFrameViewport, viewportChannelIds } from "@/hooks/useLiveFrameViewport";
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

type Handle = { report: (viewableItems: ViewToken<Row>[]) => void };
const Probe = forwardRef<Handle, { rows: Row[]; enabled: boolean }>(({ rows, enabled }, ref) => {
  const { onViewableItemsChanged } = useLiveFrameViewport("wall", enabled, rows, idsOf);
  useImperativeHandle(ref, () => ({ report: (viewableItems) => onViewableItemsChanged({ viewableItems }) }), [onViewableItemsChanged]);
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

    act(() => ref.current?.report([token(rows[0], 0)]));
    expect(mockViewable).toHaveBeenLastCalledWith("wall", ["a", "b"]);

    const grown = rows.concat({ ids: ["c"] });
    act(() => renderer.update(<Probe ref={ref} rows={grown} enabled />));
    act(() => ref.current?.report([token(grown[1], 1)]));
    expect(mockViewable).toHaveBeenLastCalledWith("wall", ["b", "c"]);

    mockFocused = false;
    act(() => renderer.update(<Probe ref={ref} rows={grown} enabled />));
    expect(mockActive).toHaveBeenLastCalledWith("wall", false);

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
    expect(mockViewable).toHaveBeenLastCalledWith("wall", ["a"]);

    act(() => renderer.update(<Probe ref={ref} rows={rows} enabled />));
    expect(mockActive).toHaveBeenLastCalledWith("wall", true);

    act(() => renderer.update(<Probe ref={ref} rows={rows} enabled={false} />));
    expect(mockActive).toHaveBeenLastCalledWith("wall", false);
    act(() => renderer.unmount());
    expect(mockViewable).toHaveBeenLastCalledWith("wall", []);
  });
});
