/** The group name prompt: a new group, a new group holding a channel, or a rename. */
import { Alert } from "react-native";

const mockCreate = jest.fn((name: string) => ({ id: "new", name, channels: [] }));
const mockRename = jest.fn();
const mockToggle = jest.fn();

jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/liveTvPreferences", () => ({
  createGroup: (name: string) => mockCreate(name),
  renameGroup: (...args: unknown[]) => mockRename(...args),
  toggleChannelInGroup: (...args: unknown[]) => mockToggle(...args),
}));

import { promptChannelGroup } from "@/components/live-tv/channel-group-prompt";

type Button = { text: string; onPress?: (text?: string) => void };
let promptSpy: jest.SpyInstance;

beforeEach(() => {
  promptSpy = jest.spyOn(Alert, "prompt").mockImplementation(() => {});
  mockCreate.mockClear();
  mockRename.mockClear();
  mockToggle.mockClear();
});

afterEach(() => promptSpy.mockRestore());

function save(text: string) {
  const buttons = promptSpy.mock.calls[0][2] as Button[];
  buttons.find((button) => button.text === "common.save")?.onPress?.(text);
}

test("a new group prompt opens empty under the new group title", () => {
  promptChannelGroup();
  expect(promptSpy.mock.calls[0][0]).toBe("liveTv.newGroup");
  expect(promptSpy.mock.calls[0][3]).toBe("plain-text");
  expect(promptSpy.mock.calls[0][4]).toBe("");
});

test("saving a new group creates it with the trimmed name", () => {
  promptChannelGroup();
  save("  News  ");
  expect(mockCreate).toHaveBeenCalledWith("News");
  expect(mockToggle).not.toHaveBeenCalled();
});

test("a new group made for a channel holds that channel", () => {
  const channel = { Name: "BBC One", ChannelNumber: "101" };
  promptChannelGroup({ channel });
  save("UK");
  expect(mockToggle).toHaveBeenCalledWith("new", channel);
});

test("renaming opens on the current name and renames on save", () => {
  promptChannelGroup({ group: { id: "g1", name: "News", channels: [] } });
  expect(promptSpy.mock.calls[0][0]).toBe("liveTv.renameGroup");
  expect(promptSpy.mock.calls[0][4]).toBe("News");
  save("World");
  expect(mockRename).toHaveBeenCalledWith("g1", "World");
  expect(mockCreate).not.toHaveBeenCalled();
});

test("a blank name saves nothing", () => {
  promptChannelGroup();
  save("   ");
  expect(mockCreate).not.toHaveBeenCalled();
});
