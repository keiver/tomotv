/**
 * The Appearance list: a failed server read still lists the themes waiting on this device, each once.
 */
import { useSavedThemes, type SavedThemesState } from "@/hooks/useSavedThemes";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const sea = { id: "t1", name: "Sea", accent: "#6CCFF6" };
const ember = { id: "t2", name: "Ember", accent: "#FF7043" };
const emberEdited = { ...ember, accent: "#C4E538" };

jest.mock("expo-router", () => {
  const { useEffect } = require("react");
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) };
});
jest.mock("@/hooks/useAuthSession", () => ({ useAuthSession: () => 1 }));
let mockNotify: () => void = () => {};
jest.mock("@/services/themeLibrary", () => {
  class ThemesUnavailableError extends Error {
    readonly pending: unknown[];
    readonly uploaded: unknown[];
    constructor(waiting: unknown[], sent: unknown[] = []) {
      super("unavailable");
      this.pending = waiting;
      this.uploaded = sent;
    }
  }
  return {
    ThemesUnavailableError,
    upsertTheme: (...args: unknown[]) => jest.requireActual("@/services/themeLibrary").upsertTheme(...args),
    loadThemes: jest.fn(),
    subscribeThemes: (listener: () => void) => {
      mockNotify = listener;
      return () => {};
    },
  };
});

const { loadThemes, ThemesUnavailableError } = jest.requireMock("@/services/themeLibrary") as {
  loadThemes: jest.Mock;
  ThemesUnavailableError: new (pending: unknown[], uploaded?: unknown[]) => Error;
};

async function mount() {
  const seen: { state: SavedThemesState | null } = { state: null };
  const Probe = () => {
    seen.state = useSavedThemes();
    return null;
  };
  await act(async () => {
    TestRenderer.create(<Probe />);
  });
  return seen;
}

describe("useSavedThemes", () => {
  beforeEach(() => loadThemes.mockReset());

  it("lists the waiting themes when the server cannot be read on opening", async () => {
    loadThemes.mockRejectedValue(new ThemesUnavailableError([ember]));
    const seen = await mount();
    expect(seen.state).toEqual({ themes: [], pending: [ember], status: "failed" });
  });

  it("drops the server's older copy of a theme now waiting on this device", async () => {
    loadThemes.mockResolvedValueOnce({ themes: [sea, ember], pending: [] });
    const seen = await mount();
    loadThemes.mockRejectedValueOnce(new ThemesUnavailableError([emberEdited]));
    await act(async () => mockNotify());
    expect(seen.state).toEqual({ themes: [sea], pending: [emberEdited], status: "failed" });
  });

  it("keeps a theme the load uploaded before its read failed, listed as the server's", async () => {
    loadThemes.mockResolvedValueOnce({ themes: [sea], pending: [ember] });
    const seen = await mount();
    loadThemes.mockRejectedValueOnce(new ThemesUnavailableError([], [ember]));
    await act(async () => mockNotify());
    expect(seen.state).toEqual({ themes: [sea, ember], pending: [], status: "failed" });
  });

  it("keeps what it last showed when the failure is not the server read", async () => {
    loadThemes.mockResolvedValueOnce({ themes: [sea], pending: [ember] });
    const seen = await mount();
    loadThemes.mockRejectedValueOnce(new Error("no config"));
    await act(async () => mockNotify());
    expect(seen.state).toEqual({ themes: [sea], pending: [ember], status: "failed" });
  });
});
