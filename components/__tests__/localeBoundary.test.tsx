/**
 * The locale boundary: a language pick remounts the screen under it, so a string a child
 * memoized is read again; a pick that keeps the language leaves the screen mounted.
 */
import { LocaleBoundary, localeScreen } from "@/components/locale-boundary";
import { setLanguage, t } from "@/services/i18n";
import React, { useEffect, useMemo } from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const mounts = jest.fn();

function Memoized() {
  useEffect(() => {
    mounts();
  }, []);
  const title = useMemo(() => t("filters.title"), []);
  return <Text>{title}</Text>;
}

const texts = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map((node) => node.props.children);

describe("LocaleBoundary", () => {
  beforeEach(() => mounts.mockClear());
  afterEach(() => act(() => setLanguage(null)));

  it("remounts its screen in the picked language, memoized strings included", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <LocaleBoundary>
          <Memoized />
        </LocaleBoundary>,
      );
    });
    expect(texts(renderer)).toEqual(["Filters"]);

    act(() => setLanguage("de"));
    expect(texts(renderer)).toEqual(["Filter"]);
    expect(mounts).toHaveBeenCalledTimes(2);
    act(() => renderer.unmount());
  });

  it("wraps a tab screen the same way", () => {
    const Screen = localeScreen(Memoized);
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Screen />);
    });
    act(() => setLanguage("fr"));
    expect(texts(renderer)).toEqual(["Filtres"]);
    act(() => renderer.unmount());
  });

  it("leaves the screen mounted when a pick keeps the language", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <LocaleBoundary>
          <Memoized />
        </LocaleBoundary>,
      );
    });
    act(() => setLanguage("en"));
    expect(mounts).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });
});
