/** The server glyph stays mounted in every state: a focusable's children never come and go, only its opacity does. */
import { SERVER_GLYPH } from "@/components/settings/ServerRow";
import { LinkSpeedHeading, linkRateOutcome } from "@/components/settings/LinkSpeedHeading";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import React from "react";
import { StyleSheet, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const glyph = (tree: TestRenderer.ReactTestRenderer) => tree.root.find((node) => node.props.name === SERVER_GLYPH);
const texts = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Text).map((node) => node.props.children);

describe("LinkSpeedHeading", () => {
  it("keeps the glyph mounted while measuring, hidden by opacity", () => {
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(<LinkSpeedHeading measuredBps={50_000_000} measuring={false} onRemeasure={() => {}} />);
    });
    expect(StyleSheet.flatten(glyph(tree!).props.style)?.opacity).not.toBe(0);

    act(() => {
      tree!.update(<LinkSpeedHeading measuredBps={50_000_000} measuring onRemeasure={() => {}} />);
    });
    expect(StyleSheet.flatten(glyph(tree!).props.style)?.opacity).toBe(0);
  });

  it("keeps the glyph mounted with no reading", () => {
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(<LinkSpeedHeading measuredBps={null} measuring={false} onRemeasure={() => {}} />);
    });
    expect(StyleSheet.flatten(glyph(tree!).props.style)?.opacity).toBe(0);
  });

  it("answers a failed tap in destructive ink with the glyph shown", () => {
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(<LinkSpeedHeading measuredBps={null} measuring={false} outcome="noReading" onRemeasure={() => {}} />);
    });
    expect(texts(tree!)).toContain(t("settings.noReading").toUpperCase());
    expect(StyleSheet.flatten(glyph(tree!).props.style)?.opacity).not.toBe(0);
    expect(glyph(tree!).props.color).toBe(COLORS.DESTRUCTIVE);
  });

  it("names a busy link in header ink with the glyph hidden", () => {
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(<LinkSpeedHeading measuredBps={null} measuring={false} outcome="linkBusy" onRemeasure={() => {}} />);
    });
    expect(texts(tree!)).toContain(t("settings.linkBusy").toUpperCase());
    expect(StyleSheet.flatten(glyph(tree!).props.style)?.opacity).toBe(0);
  });

  it("lets a landed figure outrank the tap's answer", () => {
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(<LinkSpeedHeading measuredBps={50_000_000} measuring={false} outcome="noReading" onRemeasure={() => {}} />);
    });
    expect(texts(tree!)).not.toContain(t("settings.noReading").toUpperCase());
  });
});

describe("linkRateOutcome", () => {
  it.each([
    [null, true, 0, "linkBusy"],
    [null, false, 1, "linkBusy"],
    [50_000_000, false, 2, "linkBusy"],
    [null, false, 0, "noReading"],
    [50_000_000, false, 0, null],
  ] as const)("bps %p held %p downloads %p -> %p", (bps, held, downloads, expected) => {
    expect(linkRateOutcome(bps, held, downloads)).toBe(expected);
  });
});
