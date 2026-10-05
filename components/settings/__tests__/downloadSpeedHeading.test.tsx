/** The heading shows the running transfers' rate and nothing while none runs. */
import { DownloadSpeedHeading, downloadRateLabel } from "@/components/settings/DownloadSpeedHeading";
import React from "react";
import { StyleSheet } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

let feed: ((bytesPerSecond: number) => void) | null = null;
jest.mock("@/services/downloads/manager", () => ({
  downloadManager: {
    subscribeThroughput: jest.fn((listener: (bytesPerSecond: number) => void) => {
      feed = listener;
      listener(0);
      return () => {
        feed = null;
      };
    }),
  },
}));

const glyph = (tree: TestRenderer.ReactTestRenderer) => tree.root.find((node) => node.props.name === "arrow-down-circle");
// The title and the figure are the heading's two one-line texts; the glyph's own Text has no clamp.
const texts = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => String(node.type) === "Text" && node.props.numberOfLines === 1).map((node) => node.children.join(""));

describe("downloadRateLabel", () => {
  it("words bytes per second as Mbps and hides an idle meter", () => {
    expect(downloadRateLabel(0)).toBeNull();
    expect(downloadRateLabel(250_000)).toBe("2 Mbps");
    expect(downloadRateLabel(1_537_500)).toBe("12.3 Mbps");
  });
});

describe("DownloadSpeedHeading", () => {
  it("draws the rate in the heading while a transfer runs and clears it when none does", () => {
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(<DownloadSpeedHeading />);
    });
    expect(texts(tree!)).toEqual(["ON THIS DEVICE", ""]);
    expect(StyleSheet.flatten(glyph(tree!).props.style)?.opacity).toBe(0);

    act(() => feed?.(250_000));
    expect(texts(tree!)).toEqual(["ON THIS DEVICE", "2 MBPS"]);
    expect(StyleSheet.flatten(glyph(tree!).props.style)?.opacity).not.toBe(0);
    expect(tree!.root.findByProps({ accessibilityRole: "header" }).props.accessibilityLabel).toBe("ON THIS DEVICE. Downloading at 2 Mbps");

    act(() => feed?.(0));
    expect(texts(tree!)).toEqual(["ON THIS DEVICE", ""]);

    act(() => tree!.unmount());
    expect(feed).toBeNull();
  });
});
