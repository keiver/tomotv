import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { GuideCell } from "@/components/live-tv/guide-cell";
import { MINUTE_MS, NO_GUIDE_PREFIX } from "@/utils/guide";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/jellyfinApi", () => ({ getPosterUrl: (id: string) => `poster:${id}` }));
jest.mock("expo-image", () => ({ Image: (props: { testID?: string }) => require("react").createElement("Image", props) }));
jest.mock("@/hooks/useArtTint", () => ({ useArtTint: (id: string, uri: string | null, active: boolean) => (active && uri ? "90, 20, 30" : null) }));

const T0 = Date.UTC(2026, 8, 12, 4, 0, 0);
const program = { Id: "p1", Name: "Evening News", EpisodeTitle: "Episode 9", StartDate: new Date(T0).toISOString(), EndDate: new Date(T0 + 60 * MINUTE_MS).toISOString(), IsNews: true };
const scrollX = { value: 0 } as unknown as import("react-native-reanimated").SharedValue<number>;

function render(overrides: Partial<React.ComponentProps<typeof GuideCell>> = {}) {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(
      <GuideCell program={program} left={0} width={400} height={90} nowMs={T0 + 15 * MINUTE_MS} recording={null} scrollX={scrollX} onPress={jest.fn()} onLongPress={jest.fn()} {...overrides} />,
    );
  });
  return tree!;
}

const texts = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Text).map((node) => node.props.children);
const testIds = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => typeof node.props.testID === "string").map((node) => node.props.testID as string);

describe("GuideCell", () => {
  it("shows the title, episode and the slot line", () => {
    const shown = texts(render());
    expect(shown).toEqual(expect.arrayContaining(["Evening News", "Episode 9"]));
    expect(shown.some((text) => text.includes(" – ") && text.includes("news"))).toBe(true);
  });

  it("bleeds the programme's art in from the right only when it has one", () => {
    expect(testIds(render())).not.toContain("guide-cell-art");
    expect(testIds(render({ program: { ...program, Id: "p2", ImageTags: { Primary: "tag" } } }))).toContain("guide-cell-art");
  });

  it("takes the art's tint on focus, so the fade ends in the picture's colour, and drops it on blur", () => {
    const tree = render({ program: { ...program, Id: "p5", ImageTags: { Primary: "tag" } } });
    const cell = () => tree.root.findAll((node) => Array.isArray(node.props.style) && node.props.style.some((s: { left?: number }) => s?.left === 0))[0];
    const flat = (style: unknown) => Object.assign({}, ...(Array.isArray(style) ? style.flat(2) : [style]).filter(Boolean));
    const label = tree.root.findAll((node) => node.props.isTVSelectable === true && typeof node.props.onFocus === "function")[0];
    expect(flat(cell().props.style).backgroundColor).not.toBe("rgb(90, 20, 30)");
    act(() => label.props.onFocus());
    expect(flat(cell().props.style).backgroundColor).toBe("rgb(90, 20, 30)");
    expect(flat(tree.root.findAllByProps({ testID: "guide-cell-art" })[0].props.children[1].props.style).experimental_backgroundImage).toContain("rgb(90, 20, 30) 0%");
    act(() => label.props.onBlur());
    expect(flat(cell().props.style).backgroundColor).not.toBe("rgb(90, 20, 30)");
  });

  it("marks a recording with the dot and a series rule with the repeat glyph", () => {
    expect(testIds(render({ recording: "single" }))).toContain("guide-cell-recording");
    expect(testIds(render({ recording: "series" }))).toContain("guide-cell-series");
    expect(testIds(render({ recording: null }))).not.toContain("guide-cell-recording");
  });

  it("presses through with its program and never shows progress on a stand-in cell", () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const tree = render({ onPress, onLongPress });
    const pressable = tree.root.findByProps({ accessibilityRole: "button" });
    act(() => pressable.props.onPress());
    act(() => pressable.props.onLongPress());
    expect(onPress).toHaveBeenCalledWith(program);
    expect(onLongPress).toHaveBeenCalledWith(program);

    const standIn = render({ program: { ...program, Id: `${NO_GUIDE_PREFIX}c1`, Name: "No guide data" } });
    expect(testIds(standIn)).not.toContain("guide-cell-progress");
  });
});
