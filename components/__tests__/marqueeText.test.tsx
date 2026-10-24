import React from "react";
import { Animated, Platform, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

Object.defineProperty(Platform, "isTV", { value: true, configurable: true });

const { MarqueeText, MARQUEE_PLAYS } = require("@/components/MarqueeText") as typeof import("@/components/MarqueeText");

const TITLE = "A TITLE FAR TOO LONG FOR ITS CARD";

describe("focused card title on TV", () => {
  let finish: ((result: { finished: boolean }) => void) | undefined;
  let loopConfig: { iterations?: number } | undefined;
  const timingConfigs: { useNativeDriver: boolean }[] = [];

  beforeEach(() => {
    finish = undefined;
    loopConfig = undefined;
    timingConfigs.length = 0;
    jest.spyOn(Animated, "timing").mockImplementation((_value, config) => {
      timingConfigs.push(config);
      return { start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as unknown as Animated.CompositeAnimation;
    });
    jest.spyOn(Animated, "loop").mockImplementation((_animation, config) => {
      loopConfig = config;
      return {
        start: (callback?: (result: { finished: boolean }) => void) => {
          finish = callback;
        },
        stop: jest.fn(),
        reset: jest.fn(),
      } as unknown as Animated.CompositeAnimation;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const mountOverflowing = () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<MarqueeText active>{TITLE}</MarqueeText>);
    });
    const layouts = tree.root.findAll((n) => typeof n.type === "string" && typeof n.props.onLayout === "function");
    act(() => layouts[0].props.onLayout({ nativeEvent: { layout: { width: 100 } } }));
    act(() => layouts[1].props.onLayout({ nativeEvent: { layout: { width: 300 } } }));
    return tree;
  };
  const visibleLines = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Text).at(-1)?.props.numberOfLines;

  it("scrolls on the native driver, at most MARQUEE_PLAYS times", () => {
    const tree = mountOverflowing();
    expect(loopConfig?.iterations).toBe(MARQUEE_PLAYS);
    expect(MARQUEE_PLAYS).toBe(4);
    expect(timingConfigs.length).toBeGreaterThan(0);
    expect(timingConfigs.every((config) => config.useNativeDriver)).toBe(true);
    expect(visibleLines(tree)).toBeUndefined();
    act(() => tree.unmount());
  });

  it("rests on the ellipsized title once the plays are spent", () => {
    const tree = mountOverflowing();
    act(() => finish?.({ finished: true }));
    expect(visibleLines(tree)).toBe(1);
    act(() => tree.unmount());
  });

  it("does not count a stopped loop as played", () => {
    const tree = mountOverflowing();
    act(() => finish?.({ finished: false }));
    expect(visibleLines(tree)).toBeUndefined();
    act(() => tree.unmount());
  });
});
