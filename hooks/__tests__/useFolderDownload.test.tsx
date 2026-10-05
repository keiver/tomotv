/**
 * A folder download is the one press in the app that can commit tens of gigabytes, so what is
 * under test is the arithmetic it states beforehand: how many items, how big, and whether the
 * disk can take it. Nothing may be queued before the confirmation is accepted.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Alert } from "react-native";
import { useFolderDownload } from "@/hooks/useFolderDownload";
import { downloadManager } from "@/services/downloads/manager";
import { downloadsSupported } from "@/services/downloads/paths";
import { fetchAllPlaylistItems, fetchRecursiveDownloadables } from "@/services/jellyfinApi";
import { serverTranscodeBlock } from "@/services/transcodePolicy";
import { formatFileSize } from "@/utils/mediaInfo";
import { Paths } from "expo-file-system";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

jest.mock("expo-file-system", () => ({ Paths: { availableDiskSpace: 0 } }));

jest.mock("@/services/downloads/paths", () => ({
  downloadsSupported: jest.fn(() => true),
  DISK_HEADROOM_BYTES: 500 * 1024 * 1024,
  sizeOf: (item: { MediaSources?: { Size?: number | null }[] | null }) => item.MediaSources?.[0]?.Size ?? 0,
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack, push: mockPush }) }));

jest.mock("@/services/downloads/manager", () => ({
  downloadManager: {
    hydrate: jest.fn(async () => {}),
    has: jest.fn(() => false),
    enqueue: jest.fn(async () => {}),
  },
}));

jest.mock("@/services/jellyfinApi", () => ({
  fetchRecursiveDownloadables: jest.fn(),
  fetchAllPlaylistItems: jest.fn(),
  isPhoto: (item: { Type?: string }) => item?.Type === "Photo",
}));

jest.mock("@/services/transcodePolicy", () => ({ serverTranscodeBlock: jest.fn(() => null) }));
// The sheet is replayed as an Alert so one helper reads both: a disabled size keeps no onPress.
jest.mock("@/services/downloads/sizeSheet", () => {
  const actual = jest.requireActual("@/services/downloads/sizeSheet");
  const { Alert } = require("react-native");
  return {
    ...actual,
    showSizeSheet: (title: string, message: string, choices: { text: string; disabled?: boolean; onPress: () => void }[]) =>
      Alert.alert(title, message, [
        ...choices.map((choice) => ({ text: choice.text, disabled: choice.disabled, onPress: choice.disabled ? undefined : choice.onPress })),
        { text: "Cancel", style: "cancel" },
      ]),
  };
});

const GB = 1024 ** 3;
const manager = downloadManager as jest.Mocked<typeof downloadManager>;

const FOLDER = { Id: "folder-1", Name: "Veckatimest", Type: "MusicAlbum" } as never;

function track(id: string, bytes: number, type = "Audio") {
  return { Id: id, Name: `Track ${id}`, Type: type, MediaSources: [{ Id: `s-${id}`, Size: bytes }] };
}

/** A one-hour 4K episode at 40 Mbps: every rung shrinks it. */
function episode(id: string, bytes: number) {
  return {
    Id: id,
    Name: `Episode ${id}`,
    Type: "Episode",
    RunTimeTicks: 3600 * 10_000_000,
    MediaSources: [{ Id: `s-${id}`, Size: bytes, Bitrate: 40_000_000 }],
    MediaStreams: [{ Index: 0, Type: "Video", Codec: "hevc", Width: 3840, Height: 2160, BitRate: 40_000_000 }],
  };
}

/** The texts of the buttons the last Alert offered. */
const offered = () => ((Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text: string }[]).map((button) => button.text);

/** Runs the hook's callback and returns the Alert it raised. */
async function run(folder: unknown = FOLDER) {
  let download!: (item: never) => Promise<void>;
  function Probe() {
    download = useFolderDownload() as never;
    return null;
  }
  act(() => {
    TestRenderer.create(<Probe />);
  });
  await act(async () => {
    await download(folder as never);
  });
  return (Alert.alert as jest.Mock).mock.calls.at(-1);
}

/** Presses a size on the confirmation the last Alert offered, the original by default. */
async function confirm(label = "Original") {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  await act(async () => {
    buttons.find((button) => button.text.startsWith(label))?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  (serverTranscodeBlock as jest.Mock).mockReturnValue(null);
  (downloadsSupported as jest.Mock).mockReturnValue(true);
  manager.has.mockReturnValue(false);
  (Paths as { availableDiskSpace: number }).availableDiskSpace = 50 * GB;
  (fetchRecursiveDownloadables as jest.Mock).mockResolvedValue([track("a", GB), track("b", 2 * GB)]);
});

describe("useFolderDownload", () => {
  it("states the count, the total and the space left before anything is queued", async () => {
    const [title, body] = (await run()) as [string, string];

    expect(title).toBe("Veckatimest");
    expect(body).toContain("2 items");
    expect(body).toContain("50.00 GB free");
    expect(offered()).toEqual(["Original · 3.00 GB", "Cancel"]);
    expect(manager.enqueue).not.toHaveBeenCalled();
  });

  // The reviewer's ask, for a whole season: every size under the original is one button, the
  // videos a rung shrinks convert to it and the tracks keep their originals.
  it("offers the smaller sizes for the videos of the set and converts only those", async () => {
    (fetchRecursiveDownloadables as jest.Mock).mockResolvedValue([episode("e", 18 * GB), track("a", GB)]);
    const estimate = (bitrate: number) => Math.round(((bitrate + 128_000) * 3600) / 8);
    await run();

    expect(offered()).toEqual([
      "Original · 19.00 GB",
      `1080p · ${formatFileSize(estimate(8_000_000) + GB)}`,
      `720p · ${formatFileSize(estimate(4_000_000) + GB)}`,
      `480p · ${formatFileSize(estimate(1_500_000) + GB)}`,
      "Cancel",
    ]);
    await confirm("720p");
    expect(manager.enqueue).toHaveBeenCalledWith(expect.objectContaining({ Id: "e" }), {
      group: { id: "folder-1", name: "Veckatimest" },
      convert: { label: "720p", bitrate: 4000000, width: 1280, height: 720 },
    });
    expect(manager.enqueue).toHaveBeenCalledWith(expect.objectContaining({ Id: "a" }), { group: { id: "folder-1", name: "Veckatimest" } });
  });

  it("greys the smaller sizes and says why when the account may not transcode", async () => {
    (serverTranscodeBlock as jest.Mock).mockReturnValue("account");
    (fetchRecursiveDownloadables as jest.Mock).mockResolvedValue([episode("e", 18 * GB)]);
    const [, body, buttons] = (await run()) as [string, string, { text: string; disabled?: boolean }[]];
    expect(body).toContain("your server account doesn't allow");
    expect(buttons.filter((button) => button.disabled).map((button) => button.text.split(" ")[0])).toEqual(["1080p", "720p", "480p"]);
    await confirm("720p");
    expect(manager.enqueue).not.toHaveBeenCalled();
    await confirm("Original");
    expect(manager.enqueue).toHaveBeenCalledWith(expect.objectContaining({ Id: "e" }), { group: { id: "folder-1", name: "Veckatimest" } });
  });

  it("queues every item once the confirmation is accepted", async () => {
    await run();
    await confirm();
    expect(manager.enqueue).toHaveBeenCalledTimes(2);
  });

  it("tags every item with the folder, so the Downloads screen shows one row for the set", async () => {
    await run();
    await confirm();
    expect(manager.enqueue).toHaveBeenCalledWith(expect.anything(), { group: { id: "folder-1", name: "Veckatimest" } });
  });

  it("leaves for the Downloads tab, because queuing is otherwise invisible", async () => {
    await run();
    expect(mockPush).not.toHaveBeenCalled();

    await confirm();
    // Dismisses the panel first: it is a presented modal on phone.
    expect(mockBack).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/downloads", params: { highlight: "folder-1" } });
  });

  it("does not go anywhere when the confirmation is declined", async () => {
    await run();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("refuses a set that would not fit, rather than starting and failing partway", async () => {
    (Paths as { availableDiskSpace: number }).availableDiskSpace = 2 * GB;
    const [title, body] = (await run()) as [string, string];

    expect(title).toBe("Not enough space");
    expect(body).toContain("3.00 GB");
    expect(manager.enqueue).not.toHaveBeenCalled();
  });

  it("counts the headroom the manager keeps, not just the raw free space", async () => {
    // Exactly the total free, so it fits on paper and not once the reserve is honoured.
    (Paths as { availableDiskSpace: number }).availableDiskSpace = 3 * GB;
    const [title] = (await run()) as [string];
    expect(title).toBe("Not enough space");
  });

  it("offers only what is missing when part of the folder is already held", async () => {
    manager.has.mockImplementation((id: string) => id === "a");
    const [, body] = (await run()) as [string, string];

    expect(body).toContain("1 item.");
    expect(offered()[0]).toBe("Original · 2.00 GB");
  });

  it("says so when the whole folder is already downloaded", async () => {
    manager.has.mockReturnValue(true);
    const [title] = (await run()) as [string];
    expect(title).toBe("Already downloaded");
    expect(manager.enqueue).not.toHaveBeenCalled();
  });

  it("leaves photos out of both the count and the total", async () => {
    (fetchRecursiveDownloadables as jest.Mock).mockResolvedValue([track("a", GB), track("p", 5 * GB, "Photo")]);
    const [, body] = (await run()) as [string, string];

    expect(body).toContain("1 item.");
    expect(offered()[0]).toBe("Original · 1.00 GB");
  });

  it("admits the size is unknown rather than claiming zero", async () => {
    (fetchRecursiveDownloadables as jest.Mock).mockResolvedValue([{ Id: "a", Name: "A", Type: "Audio" }]);
    await run();

    expect(offered()[0]).toBe("Original");
    // No measurement means no space verdict to make: it is offered, not refused.
    await confirm();
    expect(manager.enqueue).toHaveBeenCalledTimes(1);
  });

  it("reads a playlist from its own endpoint, since it holds references not children", async () => {
    (fetchAllPlaylistItems as jest.Mock).mockResolvedValue([track("a", GB)]);
    await run({ Id: "pl", Name: "Gym", Type: "Playlist" });

    expect(fetchAllPlaylistItems).toHaveBeenCalledWith("pl");
    expect(fetchRecursiveDownloadables).not.toHaveBeenCalled();
  });

  it("reports a failed listing as a server problem, not an empty folder", async () => {
    (fetchRecursiveDownloadables as jest.Mock).mockRejectedValue(new Error("offline"));
    const [title] = (await run()) as [string];

    expect(title).toBe("Couldn't load folder");
    expect(manager.enqueue).not.toHaveBeenCalled();
  });

  it("declines where downloads cannot exist at all", async () => {
    (downloadsSupported as jest.Mock).mockReturnValue(false);
    const [title] = (await run()) as [string];

    expect(title).toBe("Not available here");
    expect(fetchRecursiveDownloadables).not.toHaveBeenCalled();
  });
});
