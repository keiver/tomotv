/** The info panel's Stop circle outlives its recording while it holds focus, so tvOS focus never falls off the row. */
import { InfoActionRow } from "@/components/info-action-row";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
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
    expect(wrap).toMatchObject({ alignSelf: "center", maxWidth: "100%" });
    expect(row).toMatchObject({ flexDirection: "row", flexWrap: "wrap", justifyContent: "center" });
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

  it("fills the circle of a toggle that is on like the primary pill and rings one that is off like the secondary pill", async () => {
    const renderer = await mountRow({ isFavorite: true, isPlayed: false, onToggleFavorite: jest.fn(async () => true), onToggleWatched: jest.fn(async () => true) });
    const circles = renderer.root.findAllByType(FocusableButton).map((node) => node.props as { variant?: string });
    expect(circles.map((circle) => circle.variant)).toEqual(["primary", "secondary"]);
  });

  it("draws a toggle that is off in the same full accent as the download circle", async () => {
    const renderer = await mountRow({ isFavorite: false, onToggleFavorite: jest.fn(async () => true), onToggleDownload: jest.fn(async () => true), downloadState: "none" });
    const inks = renderer.root
      .findAllByType(FocusableButton)
      .map((node) => (node.props as { icon: React.ReactElement<{ children: React.ReactElement<{ color: string }>[] }> }).icon.props.children[0].props.color);
    expect(inks[0]).toBe(inks[1]);
  });

  it("puts one word inside every control's circle", async () => {
    const renderer = await mountRow({
      onToggleFavorite: jest.fn(async () => true),
      onToggleWatched: jest.fn(async () => true),
      onToggleDownload: jest.fn(async () => true),
      downloadState: "none",
      extras: [{ key: "delete", icon: "trash-outline", label: "common.delete", word: "info.word.delete", destructive: true, onPress: jest.fn() }],
    });
    const words = renderer.root
      .findAllByType(FocusableButton)
      .map((node) => (node.props as { icon: React.ReactElement<{ children: React.ReactElement<{ children: string }>[] }> }).icon.props.children[1].props.children);
    expect(words).toEqual(["info.word.favorite", "info.word.watched", "info.word.download", "info.word.delete"]);
  });
});
