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
import { Paths } from "expo-file-system";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

jest.mock("expo-file-system", () => ({ Paths: { availableDiskSpace: 0 } }));

jest.mock("@/services/downloads/paths", () => ({ downloadsSupported: jest.fn(() => true) }));

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

const GB = 1024 ** 3;
const manager = downloadManager as jest.Mocked<typeof downloadManager>;

const FOLDER = { Id: "folder-1", Name: "Veckatimest", Type: "MusicAlbum" } as never;

function track(id: string, bytes: number, type = "Audio") {
  return { Id: id, Name: `Track ${id}`, Type: type, MediaSources: [{ Id: `s-${id}`, Size: bytes }] };
}

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

/** Presses "Download" on the confirmation the last Alert offered. */
async function confirm() {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  await act(async () => {
    buttons.find((button) => button.text === "Download")?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
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
    expect(body).toContain("3.00 GB");
    expect(body).toContain("50.00 GB free");
    expect(manager.enqueue).not.toHaveBeenCalled();
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
    expect(mockPush).toHaveBeenCalledWith("/downloads");
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

    expect(body).toContain("1 item,");
    expect(body).toContain("2.00 GB");
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

    expect(body).toContain("1 item,");
    expect(body).toContain("1.00 GB");
  });

  it("admits the size is unknown rather than claiming zero", async () => {
    (fetchRecursiveDownloadables as jest.Mock).mockResolvedValue([{ Id: "a", Name: "A", Type: "Audio" }]);
    const [, body] = (await run()) as [string, string];

    expect(body).toContain("an unknown size");
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
