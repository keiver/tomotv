/** The band's corner on TV: the refresh cell stands beside Channels, Recordings and Schedule whatever the guide's sources. */
import { GuideCornerActions, scheduleSymbol } from "@/components/live-tv/guide-corner-actions";
import { COLORS } from "@/constants/colors";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/sf-symbol-icon", () => {
  const { createElement } = require("react");
  return { SfSymbolIcon: (props: { name: string; color: string }) => createElement("mock-symbol", props) };
});
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

async function renderCorner(props: { refreshing?: boolean; recording?: boolean } = {}) {
  const onRefreshGuide = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<GuideCornerActions filtered={false} onChannels={jest.fn()} onRecordings={jest.fn()} onSchedule={jest.fn()} onRefreshGuide={onRefreshGuide} {...props} />);
  });
  // The outermost node carrying each cell's props: the Pressable as the component wrote it.
  const isCell = (node: TestRenderer.ReactTestInstance) => node.props.isTVSelectable === true;
  const cells = renderer.root.findAll((node) => isCell(node) && !(node.parent && isCell(node.parent)));
  return { cells, refresh: cells[cells.length - 1], onRefreshGuide, renderer };
}

describe("GuideCornerActions", () => {
  it("draws the refresh cell last of four and passes its press on", async () => {
    const { cells, refresh, onRefreshGuide } = await renderCorner();
    expect(cells.map((cell) => cell.props.accessibilityLabel)).toEqual(["liveTv.channels", "liveTv.recordings", "liveTv.scheduled", "liveTv.guideRefresh"]);
    refresh.props.onPress();
    expect(onRefreshGuide).toHaveBeenCalledTimes(1);
  });

  it("drops the refresh press and spins while the guide is working", async () => {
    const { ActivityIndicator } = require("react-native");
    const { refresh } = await renderCorner({ refreshing: true });
    expect(refresh.props.onPress).toBeUndefined();
    expect(refresh.props.accessibilityState).toEqual({ disabled: true });
    expect(refresh.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(refresh.findAll((node) => String(node.type) === "mock-symbol")).toHaveLength(0);
  });

  it("the Schedule glyph wears its badge in red while a recording runs, the other cells keep gold", async () => {
    const symbolColors = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAll((node) => String(node.type) === "mock-symbol").map((node) => [node.props.name, node.props.color]);
    const { renderer } = await renderCorner({ recording: true });
    expect(symbolColors(renderer)).toEqual([
      ["square.grid.2x2", COLORS.ACCENT],
      ["recordingtape", COLORS.ACCENT],
      [scheduleSymbol(true), COLORS.DESTRUCTIVE],
      ["arrow.clockwise", COLORS.ACCENT],
    ]);
    expect(scheduleSymbol(true)).toMatch(/^calendar\.badge/);
    const idle = await renderCorner();
    expect(symbolColors(idle.renderer)).toContainEqual(["calendar", COLORS.ACCENT]);
    expect(symbolColors(idle.renderer).map(([, color]) => color)).toEqual(Array(4).fill(COLORS.ACCENT));
  });
});
