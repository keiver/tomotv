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
import { serverTranscodeBlock } from "@/services/transcodePolicy";
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
  isBook: (item: { Type?: string }) => item?.Type === "Book",
}));

jest.mock("expo-file-system", () => ({ Paths: { availableDiskSpace: 100 * 1024 * 1024 * 1024 } }));

jest.mock("@/services/localRemux", () => ({ predictPlaybackLane: jest.fn(async () => ({ lane: "copy", smallFeedFirst: false })) }));

jest.mock("@/utils/mediaInfo", () => ({ formatFileSize: (bytes: number) => `${bytes} B` }));

const RUNG = { label: "1080p", bitrate: 8000000, width: 1920, height: 1080 };
const mockEstimate = jest.fn((_item: unknown, _rung: { bitrate: number }) => 0);
const mockRungs = jest.fn((): (typeof RUNG)[] => []);
jest.mock("@/services/downloads/convert", () => ({
  downloadRungs: (...args: unknown[]) => mockRungs(...(args as [])),
  estimatedConvertedBytes: (item: unknown, rung: { bitrate: number }) => mockEstimate(item, rung),
}));
jest.mock("@/services/transcodePolicy", () => ({ serverTranscodeBlock: jest.fn(() => null) }));
const mockAudioLanguage = jest.fn(async (): Promise<string | null> => null);
jest.mock("@/services/audioPreference", () => ({
  readAudioPreference: () => mockAudioLanguage(),
  preferredAudioIndexIn: jest.requireActual("@/services/audioPreference").preferredAudioIndexIn,
}));
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

const manager = downloadManager as jest.Mocked<typeof downloadManager>;
let listener: ((state: DownloadsUIState) => void) | null = null;

const ITEM = { Id: "a", Name: "Bloom", Type: "Audio" } as never;

/** Presses a button on the last Alert offered. */
async function confirm(text = "Original · 10 B") {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[] | undefined;
  await act(async () => {
    buttons?.find((button) => button.text === text)?.onPress?.();
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
  mockEstimate.mockReturnValue(0);
  mockRungs.mockReturnValue([]);
  mockAudioLanguage.mockResolvedValue(null);
  (serverTranscodeBlock as jest.Mock).mockReturnValue(null);
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
    expect(manager.enqueue).toHaveBeenCalledWith({ Id: "a", Name: "Bloom", MediaSources: [{ Id: "s", Size: 10 }] }, {});
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

  // The failed row is still in the manifest, which makes enqueue a no-op; resume is what
  // re-queues it, and it keeps the entry's conversion.
  it("retries a failed transfer through resume, never through a second enqueue", async () => {
    const result = mount(ITEM);
    setState("failed");
    await act(async () => {
      await result.current?.toggle?.();
    });
    expect(manager.resume).toHaveBeenCalledWith("a");
    expect(manager.enqueue).not.toHaveBeenCalled();
    expect(fetchVideoDetails).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/downloads", params: { highlight: "a" } });
  });

  it("states the size and the space left before anything is queued", async () => {
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    const [title, body, buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1) ?? [];
    expect(title).toBe("Bloom");
    expect(body).toContain(`${100 * 1024 * 1024 * 1024} B free`);
    expect(buttons.map((button: { text: string }) => button.text)).toEqual(["Original · 10 B", "Cancel"]);
    expect(manager.enqueue).not.toHaveBeenCalled();
  });

  // The reviewer's ask: a playable file still offers the server's smaller encodes under the
  // original, each with its size, and the pick rides to the manager as the rung itself.
  it("offers the smaller sizes under the original and queues the chosen rung", async () => {
    mockRungs.mockReturnValue([RUNG, { label: "720p", bitrate: 4000000, width: 1280, height: 720 }]);
    mockEstimate.mockImplementation((_item: unknown, rung: { bitrate: number }) => rung.bitrate / 1000);
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text: string }[];
    expect(mockRungs).toHaveBeenCalledWith(expect.objectContaining({ Id: "a" }), true);
    expect(buttons.map((button) => button.text)).toEqual(["Original · 10 B", "1080p · 8000 B", "720p · 4000 B", "Cancel"]);
    await confirm("720p · 4000 B");
    expect(manager.enqueue).toHaveBeenCalledWith(expect.objectContaining({ Id: "a" }), { convert: { label: "720p", bitrate: 4000000, width: 1280, height: 720 } });
  });

  // A conversion records one audio track, so it is the one in the viewer's audio language.
  it("records the audio track in the viewer's language on a smaller size", async () => {
    mockRungs.mockReturnValue([RUNG]);
    mockEstimate.mockReturnValue(4000);
    mockAudioLanguage.mockResolvedValue("ja");
    (fetchVideoDetails as jest.Mock).mockResolvedValue({
      Id: "a",
      Name: "Bloom",
      MediaSources: [{ Id: "s", Size: 10 }],
      MediaStreams: [
        { Type: "Video", Index: 0 },
        { Type: "Audio", Index: 1, Language: "eng", IsDefault: true },
        { Type: "Audio", Index: 2, Language: "jpn" },
      ],
    });
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    await confirm("1080p · 4000 B");
    expect(manager.enqueue).toHaveBeenCalledWith(expect.objectContaining({ Id: "a" }), { convert: RUNG, audioIndex: 2 });
  });

  it("drops a size that would not fit and keeps the ones that do", async () => {
    mockRungs.mockReturnValue([RUNG]);
    (fetchVideoDetails as jest.Mock).mockResolvedValue({ Id: "a", Name: "Bloom", MediaSources: [{ Id: "s", Size: 200 * 1024 * 1024 * 1024 }] });
    mockEstimate.mockReturnValue(1024);
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text: string }[];
    expect(buttons.map((button) => button.text)).toEqual(["1080p · 1024 B", "Cancel"]);
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
  // server, so the original is never queued: the server re-encodes it on the way down instead.
  it("offers a conversion for an item only the server can play, and queues it as one", async () => {
    (predictPlaybackLane as jest.Mock).mockResolvedValue({ lane: "server", smallFeedFirst: false });
    mockRungs.mockReturnValue([RUNG]);
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    const [, body, buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1) ?? [];
    expect(body).toContain("won't play offline");
    // The original is never offered, and the ladder is asked without the shrink rule.
    expect(buttons.map((button: { text: string }) => button.text)).toEqual(["1080p", "Cancel"]);
    expect(mockRungs).toHaveBeenCalledWith(expect.objectContaining({ Id: "a" }), false);
    expect(manager.enqueue).not.toHaveBeenCalled();
    await confirm("1080p");
    expect(manager.enqueue).toHaveBeenCalledWith(expect.objectContaining({ Id: "a" }), { convert: RUNG });
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/downloads", params: { highlight: "a" } });
  });

  // Server transcoding off in Settings: the smaller sizes stay listed, greyed, and the sheet says why.
  it("greys the smaller sizes and names the setting when transcoding is off on this device", async () => {
    (serverTranscodeBlock as jest.Mock).mockReturnValue("device");
    mockRungs.mockReturnValue([RUNG]);
    mockEstimate.mockReturnValue(4000);
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    const [, body, buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1) ?? [];
    expect(body).toContain("off in Settings");
    expect(buttons.map((button: { text: string; disabled?: boolean }) => [button.text, !!button.disabled])).toEqual([
      ["Original · 10 B", false],
      ["1080p · 4000 B", true],
      ["Cancel", false],
    ]);
    await confirm("1080p · 4000 B");
    expect(manager.enqueue).not.toHaveBeenCalled();
  });

  it("offers nothing for a file that needs a server this device will not ask", async () => {
    (predictPlaybackLane as jest.Mock).mockResolvedValue({ lane: "unplayable", smallFeedFirst: false });
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    const alert = (Alert.alert as jest.Mock).mock.calls.at(-1);
    expect(alert?.[1]).toContain("server transcoding is off");
    expect(alert?.[2].map((button: { text: string }) => button.text)).toEqual(["OK"]);
    expect(manager.enqueue).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("refuses a conversion the estimate says will not fit, before offering it", async () => {
    (predictPlaybackLane as jest.Mock).mockResolvedValue({ lane: "server", smallFeedFirst: false });
    mockRungs.mockReturnValue([RUNG]);
    mockEstimate.mockReturnValue(200 * 1024 * 1024 * 1024);
    const result = mount(ITEM);
    await act(async () => {
      await result.current?.toggle?.();
    });
    expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[0]).toBe("Not enough space");
    expect(manager.enqueue).not.toHaveBeenCalled();
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
