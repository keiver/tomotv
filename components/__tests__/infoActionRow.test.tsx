/** The info panel's Stop circle outlives its recording while it holds focus, so tvOS focus never falls off the row. */
import { fittedSlot, InfoActionRow } from "@/components/info-action-row";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null, BUTTON_BORDER_WIDTH: 3 }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

const { FocusableButton } = jest.requireMock("@/components/FocusableButton") as { FocusableButton: React.ComponentType };
type CircleProps = { accessibilityLabel: string; onFocus: () => void; onBlur: () => void; onPress?: () => void };
const stopCircle = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(FocusableButton).find((node) => (node.props as CircleProps).accessibilityLabel === "liveTv.stopRecording")?.props as CircleProps | undefined;

describe("InfoActionRow stop circle", () => {
  it("stays, spent, while focused after the recording stops, and leaves with focus", async () => {
    const stop = jest.fn(async () => true);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<InfoActionRow onStopRecording={stop} />);
    });
    await act(async () => stopCircle(renderer)!.onFocus());
    await act(async () => renderer.update(<InfoActionRow />));
    const spent = stopCircle(renderer);
    expect(spent).toBeDefined();
    expect(spent!.onPress).toBeUndefined();
    await act(async () => spent!.onBlur());
    expect(stopCircle(renderer)).toBeUndefined();
  });

  it("goes at once when the recording stops without focus on it", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<InfoActionRow onStopRecording={jest.fn(async () => true)} />);
    });
    await act(async () => renderer.update(<InfoActionRow />));
    expect(stopCircle(renderer)).toBeUndefined();
  });
});

describe("InfoActionRow layout", () => {
  it("wraps its circles inside the panel's width instead of overflowing it", async () => {
    const { StyleSheet, View } = jest.requireActual("react-native");
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<InfoActionRow onToggleFavorite={jest.fn(async () => true)} onToggleWatched={jest.fn(async () => true)} />);
    });
    const [wrap, row] = renderer.root.findAllByType(View).map((node: TestRenderer.ReactTestInstance) => StyleSheet.flatten(node.props.style));
    expect(wrap).toMatchObject({ alignSelf: "stretch", maxWidth: "100%" });
    expect(row).toMatchObject({ flexDirection: "row", flexWrap: "wrap", justifyContent: "center" });
  });

  it("narrows the touch slots so five circles share a 375pt iPhone's 319pt card, and keeps full size when that would go under 56pt", () => {
    expect(fittedSlot(319, 5)).toEqual({ slot: 63, circle: 59 });
    expect(fittedSlot(400, 4)).toEqual({ slot: 76, circle: 66 });
    expect(fittedSlot(319, 6)).toEqual({ slot: 76, circle: 66 });
    expect(fittedSlot(0, 5)).toEqual({ slot: 76, circle: 66 });
  });
});

describe("InfoActionRow toggles and actions", () => {
  const mountRow = async (props: React.ComponentProps<typeof InfoActionRow>) => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<InfoActionRow {...props} />);
    });
    return renderer;
  };

  it("renders every control as its own circle, toggles first then actions", async () => {
    const renderer = await mountRow({
      onToggleFavorite: jest.fn(async () => true),
      onToggleWatched: jest.fn(async () => true),
      onToggleProgress: jest.fn(() => true),
      onToggleDownload: jest.fn(async () => true),
      downloadState: "none",
      extras: [{ key: "delete", icon: "trash-outline", label: "common.delete", word: "info.word.delete", destructive: true, onPress: jest.fn() }],
    });
    expect(renderer.root.findAllByType(FocusableButton).map((node) => (node.props as CircleProps).accessibilityLabel)).toEqual([
      "info.addFavorite",
      "info.markWatched",
      "info.clearProgress",
      "info.download",
      "common.delete",
    ]);
  });

  type Circle = { style: { backgroundColor: string }; icon: React.ReactElement<{ name: string; color: string }>; onFocus: () => void };
  const circles = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType(FocusableButton).map((node) => node.props as Circle);

  it("gives a toggle that is on and one that is off the same circle and tells them apart by a filled or outline icon", async () => {
    const renderer = await mountRow({ isFavorite: true, isPlayed: false, onToggleFavorite: jest.fn(async () => true), onToggleWatched: jest.fn(async () => true) });
    const [favorite, watched] = circles(renderer);
    expect(favorite.style.backgroundColor).toBe(watched.style.backgroundColor);
    expect(favorite.icon.props.name).toBe("heart");
    expect(watched.icon.props.name).toBe("eye-off");
  });

  it("draws a toggle that is off in the same accent as the download circle", async () => {
    const renderer = await mountRow({ isFavorite: false, onToggleFavorite: jest.fn(async () => true), onToggleDownload: jest.fn(async () => true), downloadState: "none" });
    const [favorite, download] = circles(renderer);
    expect(favorite.icon.props.color).toBe(download.icon.props.color);
  });

  it("fills only the focused circle and switches its icon to the ink that sits on the fill", async () => {
    const renderer = await mountRow({ isFavorite: true, onToggleFavorite: jest.fn(async () => true), onToggleWatched: jest.fn(async () => true) });
    const [rest] = circles(renderer);
    await act(async () => circles(renderer)[1].onFocus());
    const [favorite, watched] = circles(renderer);
    expect(favorite.style.backgroundColor).toBe(rest.style.backgroundColor);
    expect(watched.style.backgroundColor).not.toBe(rest.style.backgroundColor);
    expect(watched.icon.props.color).not.toBe(favorite.icon.props.color);
  });

  it("borders the action circles with the pill CTA's border width and leaves the toggles bare", async () => {
    const { BUTTON_BORDER_WIDTH } = jest.requireMock("@/components/FocusableButton") as { BUTTON_BORDER_WIDTH: number };
    const renderer = await mountRow({
      onToggleFavorite: jest.fn(async () => true),
      onToggleDownload: jest.fn(async () => true),
      downloadState: "none",
      extras: [{ key: "subtitles", icon: "text-outline", label: "info.findSubtitles", word: "info.word.subtitles", onPress: jest.fn() }],
    });
    const borders = renderer.root.findAllByType(FocusableButton).map((node) => (node.props as { style: { borderWidth: number } }).style.borderWidth);
    expect(borders).toEqual([0, BUTTON_BORDER_WIDTH, BUTTON_BORDER_WIDTH]);
  });

  it("puts extra space before the first action only when toggles come before it", async () => {
    const { StyleSheet } = jest.requireActual("react-native");
    const extras = [{ key: "subtitles", icon: "text-outline" as const, label: "info.findSubtitles", word: "info.word.subtitles", onPress: jest.fn() }];
    const leftMargins = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType(FocusableButton).map((node) => StyleSheet.flatten(node.parent!.props.style).marginLeft ?? 0);
    const mixed = await mountRow({ onToggleFavorite: jest.fn(async () => true), onToggleDownload: jest.fn(async () => true), downloadState: "none", extras });
    const [toggle, firstAction, secondAction] = leftMargins(mixed);
    expect(toggle).toBe(0);
    expect(firstAction).toBeGreaterThan(0);
    expect(secondAction).toBe(0);
    expect(leftMargins(await mountRow({ extras }))).toEqual([0]);
  });

  it("puts one word under every control's circle", async () => {
    const { Text } = jest.requireActual("react-native");
    const renderer = await mountRow({
      onToggleFavorite: jest.fn(async () => true),
      onToggleWatched: jest.fn(async () => true),
      onToggleDownload: jest.fn(async () => true),
      downloadState: "none",
      extras: [{ key: "delete", icon: "trash-outline", label: "common.delete", word: "info.word.delete", destructive: true, onPress: jest.fn() }],
    });
    const words = renderer.root.findAllByType(Text).map((node: TestRenderer.ReactTestInstance) => node.props.children);
    expect(words.slice(0, 4)).toEqual(["info.word.favorite", "info.word.watched", "info.word.download", "info.word.delete"]);
  });
});
