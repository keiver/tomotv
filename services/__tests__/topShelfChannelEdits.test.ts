/**
 * Top Shelf channel edits: the account's hidden and renamed channels are written as one file in the
 * App Group container when they change, and tvOS is told to reload the shelf only for a changed file.
 */
const GROUP = "file:///group";
const EDITS = `${GROUP}/Library/Caches/topshelf-channel-edits.json`;

const mockReload = jest.fn(async () => undefined);
let mockPreferences = { hidden: [] as unknown[], renames: [] as unknown[] };
const mockPreferenceListeners = new Set<() => void>();
const mockAuthListeners = new Set<() => void>();
const mockNativeModules: Record<string, unknown> = { TopShelfReload: { reload: () => mockReload() } };
const mockPlatform = { OS: "ios", isTV: true };

jest.mock("expo-file-system", () => {
  const fake = require("./fakeFileSystem");
  return { ...fake, Paths: { ...fake.Paths, appleSharedContainers: { "group.dev.keiver.tomotv": { uri: "file:///group" } } } };
});
jest.mock("react-native", () => ({ Platform: mockPlatform, NativeModules: mockNativeModules }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/liveTvPreferences", () => ({
  getLiveTvPreferences: () => mockPreferences,
  subscribeLiveTvPreferences: (listener: () => void) => {
    mockPreferenceListeners.add(listener);
    return () => mockPreferenceListeners.delete(listener);
  },
}));
jest.mock("@/services/jellyfinApi", () => ({
  subscribeAuthChange: (listener: () => void) => {
    mockAuthListeners.add(listener);
    return () => mockAuthListeners.delete(listener);
  },
}));

let fakeFs: Map<string, { content: string; isDirectory: boolean }>;
let shelf: typeof import("@/services/topShelfChannelEdits");

beforeEach(() => {
  jest.clearAllMocks();
  mockPreferences = { hidden: [], renames: [] };
  mockPreferenceListeners.clear();
  mockAuthListeners.clear();
  mockPlatform.isTV = true;
  mockNativeModules.TopShelfReload = { reload: () => mockReload() };
  jest.isolateModules(() => {
    ({ fakeFs } = require("./fakeFileSystem"));
    shelf = require("@/services/topShelfChannelEdits");
  });
  fakeFs.clear();
});

const written = () => fakeFs.get(EDITS)?.content;

describe("startShelfChannelEdits", () => {
  it("writes the account's edits at once and again when they change, reloading the shelf each time", () => {
    mockPreferences = { hidden: [{ id: "x", number: "9.1", name: "KQED" }], renames: [] };
    const stop = shelf.startShelfChannelEdits();
    expect(written()).toBe(JSON.stringify({ hidden: [{ id: "x", number: "9.1", name: "KQED" }], renames: [] }));
    expect(mockReload).toHaveBeenCalledTimes(1);

    mockPreferences = { hidden: [], renames: [{ name: "Al Jazeera English", displayName: "AJE" }] };
    mockPreferenceListeners.forEach((listener) => listener());
    expect(written()).toBe(JSON.stringify({ hidden: [], renames: [{ name: "Al Jazeera English", displayName: "AJE" }] }));
    expect(mockReload).toHaveBeenCalledTimes(2);

    // An unchanged document is neither written nor announced.
    mockPreferenceListeners.forEach((listener) => listener());
    expect(mockReload).toHaveBeenCalledTimes(2);

    // Another account's lists after a switch.
    mockPreferences = { hidden: [], renames: [] };
    mockAuthListeners.forEach((listener) => listener());
    expect(written()).toBe(JSON.stringify({ hidden: [], renames: [] }));
    expect(mockReload).toHaveBeenCalledTimes(3);

    stop();
    expect(mockPreferenceListeners.size).toBe(0);
    expect(mockAuthListeners.size).toBe(0);
  });

  it("does nothing off the Apple TV or without the reload module", () => {
    mockPlatform.isTV = false;
    shelf.startShelfChannelEdits();
    expect(written()).toBeUndefined();
    mockPlatform.isTV = true;
    delete mockNativeModules.TopShelfReload;
    shelf.startShelfChannelEdits();
    expect(written()).toBeUndefined();
    expect(mockReload).not.toHaveBeenCalled();
  });
});

describe("shelfChannelEditsDocument", () => {
  it("carries the lists as the preferences hold them", () => {
    const hidden = [{ number: "9.1", name: "KQED" }];
    const renames = [{ id: "y", name: "Two", displayName: "Second" }];
    expect(JSON.parse(shelf.shelfChannelEditsDocument({ hidden, renames }))).toEqual({ hidden, renames });
  });
});
