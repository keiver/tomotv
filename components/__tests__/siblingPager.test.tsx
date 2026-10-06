/**
 * The info panel's left/right drag. The release rule decides whether a swipe moves on, and the
 * window decides what stays mounted: the opened page must keep its place and its instance when
 * the sibling list lands after it painted.
 */
import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import { dragOffset, pageWindow, releaseStep, SiblingPager } from "@/components/sibling-pager";

jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const chain: any = new Proxy(() => chain, { get: () => () => chain, apply: () => chain });
  return { Gesture: { Pan: () => chain }, GestureDetector: ({ children }: { children: React.ReactNode }) => children, GestureHandlerRootView: View };
});

const WIDTH = 400;

describe("releaseStep", () => {
  it("moves on past the commit distance, either way", () => {
    expect(releaseStep(-150, 0, WIDTH, true, true)).toBe(1);
    expect(releaseStep(150, 0, WIDTH, true, true)).toBe(-1);
  });

  it("settles back on a short, slow drag", () => {
    expect(releaseStep(-100, -200, WIDTH, true, true)).toBe(0);
  });

  it("moves on a flick that way, and settles back on a flick against it", () => {
    expect(releaseStep(-40, -900, WIDTH, true, true)).toBe(1);
    expect(releaseStep(-300, 900, WIDTH, true, true)).toBe(0);
  });

  it("never steps toward a page that is not there", () => {
    expect(releaseStep(-300, -900, WIDTH, true, false)).toBe(0);
    expect(releaseStep(300, 900, WIDTH, false, true)).toBe(0);
  });
});

describe("dragOffset", () => {
  it("follows the finger toward a neighbour, never past one page", () => {
    expect(dragOffset(0, -120, WIDTH, true, true)).toBe(-120);
    expect(dragOffset(0, -700, WIDTH, true, true)).toBe(-WIDTH);
    expect(dragOffset(0, 700, WIDTH, true, true)).toBe(WIDTH);
  });

  it("resists past either end", () => {
    expect(dragOffset(0, -90, WIDTH, true, false)).toBe(-30);
    expect(dragOffset(0, 90, WIDTH, false, true)).toBe(30);
  });

  it("picks up where an interrupted settle left the pages", () => {
    expect(dragOffset(-200, 50, WIDTH, true, true)).toBe(-150);
  });
});

describe("pageWindow", () => {
  it("keeps the shown page and the neighbours that exist", () => {
    expect(pageWindow(0, 5, 10)).toEqual([-1, 0, 1]);
    expect(pageWindow(0, 0, 10)).toEqual([0, 1]);
    expect(pageWindow(0, 9, 10)).toEqual([-1, 0]);
    expect(pageWindow(0, 0, 1)).toEqual([0]);
  });
});

describe("SiblingPager", () => {
  const mounts: Record<string, number> = {};
  function Page({ id }: { id: string; active: boolean }) {
    useEffect(() => {
      mounts[id] = (mounts[id] ?? 0) + 1;
    }, [id]);
    return null;
  }
  const renderPage = (id: string, active: boolean) => <Page id={id} active={active} />;

  /** Where the pager placed each page, and which one it shows. */
  function slots(tree: TestRenderer.ReactTestRenderer) {
    return Object.fromEntries(tree.root.findAllByType(Page).map((page) => [page.props.id, { left: StyleSheet.flatten(page.parent!.props.style).left, active: page.props.active }]));
  }

  beforeEach(() => {
    for (const key of Object.keys(mounts)) delete mounts[key];
  });

  it("keeps the opened page in place, mounted once, when its siblings arrive", async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SiblingPager ids={["e5"]} initialId="e5" renderPage={renderPage} />);
    });
    expect(slots(tree!)).toEqual({ e5: { left: 0, active: true } });

    await act(async () => {
      tree!.update(<SiblingPager ids={["e1", "e2", "e3", "e4", "e5", "e6"]} initialId="e5" renderPage={renderPage} />);
    });
    const after = slots(tree!);
    expect(after.e5).toEqual({ left: 0, active: true });
    expect(after.e4.active).toBe(false);
    expect(after.e6.active).toBe(false);
    expect(after.e4.left).toBeLessThan(0);
    expect(after.e6.left).toBeGreaterThan(0);
    expect(Object.keys(after).sort()).toEqual(["e4", "e5", "e6"]);
    expect(mounts.e5).toBe(1);
  });
});
