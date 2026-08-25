/**
 * The info panel's download circle: which items get one, which manager call each state's press
 * makes, and that every press ends on the Downloads tab. The circle is the only way into the
 * feature, so a wrong press here is a download that silently does the opposite of the glyph.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useItemDownload } from "@/hooks/useItemDownload";
import { downloadManager } from "@/services/downloads/manager";
import { downloadsSupported } from "@/services/downloads/paths";
import { fetchVideoDetails } from "@/services/jellyfinApi";
import { predictPlaybackLane } from "@/services/localRemux";
import { Alert } from "react-native";
import type { DownloadsUIState } from "@/services/downloads/manager";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

jest.mock("@/services/downloads/paths", () => ({
  downloadsSupported: jest.fn(() => true),
  DISK_HEADROOM_BYTES: 500 * 1024 * 1024,
  sizeOf: (item: { MediaSources?: { Size?: number | null }[] | null }) => item.MediaSources?.[0]?.Size ?? 0,
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack, push: mockPush }) }));

/** The manager's whole surface here is what it currently holds, which is what the hook reads. */
const mockEntries: { itemId: string; state: string; bytesWritten: number; totalBytes: number }[] = [];
jest.mock("@/services/downloads/manager", () => ({
  downloadManager: {
    getState: () => ({ entries: mockEntries, activeCount: 0, hydrated: true }),
    subscribe: jest.fn(),
    enqueue: jest.fn(async () => {}),
    pause: jest.fn(async () => {}),
    resume: jest.fn(),
    remove: jest.fn(async () => {}),
  },
}));

jest.mock("@/services/jellyfinApi", () => ({
  fetchVideoDetails: jest.fn(),
  isFolder: (item: { Type?: string }) => item?.Type === "MusicAlbum",
  isPhoto: (item: { Type?: string }) => item?.Type === "Photo",
}));

jest.mock("expo-file-system", () => ({ Paths: { availableDiskSpace: 100 * 1024 * 1024 * 1024 } }));

jest.mock("@/services/localRemux", () => ({ predictPlaybackLane: jest.fn(async () => ({ lane: "copy", smallFeedFirst: false })) }));

jest.mock("@/utils/mediaInfo", () => ({ formatFileSize: (bytes: number) => `${bytes} B` }));

const manager = downloadManager as jest.Mocked<typeof downloadManager>;
let listener: ((state: DownloadsUIState) => void) | null = null;

const ITEM = { Id: "a", Name: "Bloom", Type: "Audio" } as never;

/** Presses "Download" on the size confirmation the last Alert offered. */
async function confirm() {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[] | undefined;
  await act(async () => {
    buttons?.find((button) => button.text === "Download")?.onPress?.();
  });
}

/** Renders the hook and hands back its latest return value. */
function mount(item: unknown) {
  const result = { current: null as ReturnType<typeof useItemDownload> | null };
  function Probe() {
    result.current = useItemDownload(item as never);
    return null;
  }
  act(() => {
    TestRenderer.create(<Probe />);
  });
  return result;
}

function setState(state: string, bytes: { bytesWritten: number; totalBytes: number } = { bytesWritten: 0, totalBytes: 100 }) {
  mockEntries.splice(0, mockEntries.length, { itemId: "a", state, ...bytes });
  act(() => listener?.({ entries: mockEntries, activeCount: 0, hydrated: true } as never));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEntries.length = 0;
  listener = null;
  (downloadsSupported as jest.Mock).mockReturnValue(true);
  manager.subscribe.mockImplementation((fn) => {
    listener = fn;
    return () => {
      listener = null;
    };
  });
  (fetchVideoDetails as jest.Mock).mockResolvedValue({ Id: "a", Name: "Bloom", MediaSources: [{ Id: "s", Size: 10 }] });
  (predictPlaybackLane as jest.Mock).mockResolvedValue({ lane: "copy", smallFeedFirst: false });
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

describe("useItemDownload", () => {
  it("offers nothing where downloads cannot exist", () => {
    (downloadsSupported as jest.Mock).mockReturnValue(false);
    expect(mount(ITEM).current?.state).toBeUndefined();
  });

  it("offers nothing for a container or a photo", () => {
    expect(mount({ Id: "b", Type: "MusicAlbum" }).current?.state).toBeUndefined();
    expect(mount({ Id: "c", Type: "Photo" }).current?.state).toBeUndefined();
  });

  it("starts at none and follows the manager", () => {
    const result = mount(ITEM);
    expect(result.current?.state).toBe("none");
    setState("downloading");
    expect(result.current?.state).toBe("downloading");
  });

  it("fetches playback details before queueing, because the panel's own fetch has no MediaSources", async () => {
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    expect(fetchVideoDetails).toHaveBeenCalledWith("a");
    await confirm();
    expect(manager.enqueue).toHaveBeenCalledWith({ Id: "a", Name: "Bloom", MediaSources: [{ Id: "s", Size: 10 }] });
  });

  it("leaves for the Downloads tab once the item is queued, because queuing is otherwise invisible", async () => {
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    await confirm();
    // Dismisses the panel first: it is a presented modal on phone.
    expect(mockBack).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/downloads", params: { highlight: "a" } });
  });

  it("stays on the panel when the queue never happened, so the caption can report it", async () => {
    (fetchVideoDetails as jest.Mock).mockResolvedValue(null);
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("reports failure rather than queueing when the details cannot be fetched", async () => {
    (fetchVideoDetails as jest.Mock).mockResolvedValue(null);
    const result = mount(ITEM);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current?.toggle?.();
    });
    expect(ok).toBe(false);
    expect(manager.enqueue).not.toHaveBeenCalled();
  });

  it.each(["queued", "downloading", "paused", "ready"])("sends %s to the Downloads tab and never touches the file", async (state) => {
    const result = mount(ITEM);
    setState(state);
    await act(async () => {
      await result.current?.toggle?.();
    });

    // Dismiss first: this panel is a presented modal on phone.
    expect(mockBack).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/downloads", params: { highlight: "a" } });
    // The press that used to throw the file away.
    expect(manager.remove).not.toHaveBeenCalled();
    expect(manager.pause).not.toHaveBeenCalled();
    expect(manager.enqueue).not.toHaveBeenCalled();
  });

  it("retries a failed transfer by queueing it again", async () => {
    const result = mount(ITEM);
    setState("failed");
    await act(async () => {
      await result.current?.toggle?.();
    });
    await confirm();
    expect(manager.enqueue).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/downloads", params: { highlight: "a" } });
  });

  it("states the size and the space left before anything is queued", async () => {
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    const [title, body] = (Alert.alert as jest.Mock).mock.calls.at(-1) ?? [];
    expect(title).toBe("Bloom");
    expect(body).toContain("10 B");
    expect(manager.enqueue).not.toHaveBeenCalled();
  });

  it("queues nothing when the confirmation is declined", async () => {
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    expect(manager.enqueue).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  // A file the device cannot play on its own would finish downloading and still need the
  // server, which is the one thing a download exists to do without.
  it("refuses an item only the server can play, and never queues it", async () => {
    (predictPlaybackLane as jest.Mock).mockResolvedValue({ lane: "server", smallFeedFirst: false });
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[1]).toContain("won't play offline");
    expect(manager.enqueue).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("swallows a manager refusal rather than throwing out of the confirmation", async () => {
    manager.enqueue.mockRejectedValue(new Error("Not enough free space for this download"));
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    await confirm();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
