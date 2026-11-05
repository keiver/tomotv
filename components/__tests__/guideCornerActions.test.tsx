/** The band's corner on TV: Channels, Multiview, Recordings and the refresh cell, whatever the guide's sources. */
import { GuideCornerActions } from "@/components/live-tv/guide-corner-actions";
import { COLORS } from "@/constants/colors";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/sf-symbol-icon", () => {
  const { createElement } = require("react");
  return { SfSymbolIcon: (props: { name: string; color: string }) => createElement("mock-symbol", props) };
});
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

async function renderCorner(props: { refreshing?: boolean; recording?: boolean; claimFocus?: boolean; multiview?: boolean } = {}) {
  const onRefreshGuide = jest.fn();
  const onMultiview = jest.fn();
  const { multiview = true, ...rest } = props;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <GuideCornerActions filtered={false} onChannels={jest.fn()} onMultiview={multiview ? onMultiview : undefined} onRecordings={jest.fn()} onRefreshGuide={onRefreshGuide} {...rest} />,
    );
  });
  // The outermost node carrying each cell's props: the Pressable as the component wrote it.
  const isCell = (node: TestRenderer.ReactTestInstance) => node.props.isTVSelectable === true;
  const cells = renderer.root.findAll((node) => isCell(node) && !(node.parent && isCell(node.parent)));
  return { cells, refresh: cells[cells.length - 1], onRefreshGuide, onMultiview, renderer };
}

describe("GuideCornerActions", () => {
  it("draws Channels, Multiview, Recordings and the refresh cell last, and passes their presses on", async () => {
    const { cells, refresh, onRefreshGuide, onMultiview } = await renderCorner();
    expect(cells.map((cell) => cell.props.accessibilityLabel)).toEqual(["liveTv.channels", "liveTv.multiview", "liveTv.recordings", "liveTv.guideRefresh"]);
    refresh.props.onPress();
    expect(onRefreshGuide).toHaveBeenCalledTimes(1);
    cells[1].props.onPress();
    expect(onMultiview).toHaveBeenCalledTimes(1);
  });

  it("leaves Multiview out when the guide has no Multiview to open", async () => {
    const { cells } = await renderCorner({ multiview: false });
    expect(cells.map((cell) => cell.props.accessibilityLabel)).toEqual(["liveTv.channels", "liveTv.recordings", "liveTv.guideRefresh"]);
  });

  it("only the Channels cell claims focus, and only while asked to", async () => {
    const claimed = await renderCorner({ claimFocus: true });
    expect(claimed.cells.map((cell) => cell.props.hasTVPreferredFocus === true)).toEqual([true, false, false, false]);
    const idle = await renderCorner();
    expect(idle.cells.some((cell) => cell.props.hasTVPreferredFocus === true)).toBe(false);
  });

  it("drops the refresh press and spins while the guide is working", async () => {
    const { ActivityIndicator } = require("react-native");
    const { refresh } = await renderCorner({ refreshing: true });
    expect(refresh.props.onPress).toBeUndefined();
    expect(refresh.props.accessibilityState).toEqual({ disabled: true });
    expect(refresh.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(refresh.findAll((node) => String(node.type) === "mock-symbol")).toHaveLength(0);
  });

  it("the Recordings glyph turns red while a recording runs, the other cells keep gold", async () => {
    const symbolColors = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAll((node) => String(node.type) === "mock-symbol").map((node) => [node.props.name, node.props.color]);
    const { renderer } = await renderCorner({ recording: true });
    expect(symbolColors(renderer)).toEqual([
      ["square.grid.2x2", COLORS.ACCENT],
      ["rectangle.3.group", COLORS.ACCENT],
      ["recordingtape", COLORS.DESTRUCTIVE],
      ["arrow.clockwise", COLORS.ACCENT],
    ]);
    const idle = await renderCorner();
    expect(symbolColors(idle.renderer).map(([, color]) => color)).toEqual(Array(4).fill(COLORS.ACCENT));
  });
});
