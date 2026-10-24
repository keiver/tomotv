/** The info panel's Stop circle outlives its recording while it holds focus, so tvOS focus never falls off the row. */
import { InfoActionRow } from "@/components/info-action-row";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/glass-button", () => ({ GlassButton: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

const { GlassButton } = jest.requireMock("@/components/glass-button") as { GlassButton: React.ComponentType };
type CircleProps = { accessibilityLabel: string; onFocus: () => void; onBlur: () => void; onPress?: () => void };
const stopCircle = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(GlassButton).find((node) => (node.props as CircleProps).accessibilityLabel === "liveTv.stopRecording")?.props as CircleProps | undefined;

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

  it("puts favorite, watched and progress in the toggle group, and download and delete outside it", async () => {
    const { GlassToggleGroup } = jest.requireActual("@/components/glass-toggle-group");
    const renderer = await mountRow({
      onToggleFavorite: jest.fn(async () => true),
      onToggleWatched: jest.fn(async () => true),
      onToggleProgress: jest.fn(() => true),
      onToggleDownload: jest.fn(async () => true),
      downloadState: "none",
      extras: [{ key: "delete", icon: "trash-outline", label: "common.delete", word: "info.word.delete", destructive: true, onPress: jest.fn() }],
    });
    const group = renderer.root.findByType(GlassToggleGroup);
    expect((group.props.toggles as { key: string }[]).map((toggle) => toggle.key)).toEqual(["favorite", "watched", "progress"]);
    expect(renderer.root.findAllByType(GlassButton).map((node) => (node.props as CircleProps).accessibilityLabel)).toEqual(["info.download", "common.delete"]);
  });

  it("fills a toggle that is on with the solid accent and leaves one that is off clear", async () => {
    const { FocusableButton } = jest.requireActual("@/components/FocusableButton");
    const renderer = await mountRow({ isFavorite: true, isPlayed: false, onToggleFavorite: jest.fn(async () => true), onToggleWatched: jest.fn(async () => true) });
    const variants = renderer.root.findAllByType(FocusableButton).map((node) => node.props.variant);
    expect(variants).toEqual(["primary", "link"]);
  });

  it("writes one word under every control", async () => {
    const { Text } = jest.requireActual("react-native");
    const renderer = await mountRow({
      onToggleFavorite: jest.fn(async () => true),
      onToggleWatched: jest.fn(async () => true),
      onToggleDownload: jest.fn(async () => true),
      downloadState: "none",
      extras: [{ key: "delete", icon: "trash-outline", label: "common.delete", word: "info.word.delete", destructive: true, onPress: jest.fn() }],
    });
    const words = renderer.root.findAllByType(Text).map((node) => node.props.children);
    expect(words).toEqual(expect.arrayContaining(["info.word.favorite", "info.word.watched", "info.word.download", "info.word.delete"]));
  });
});
