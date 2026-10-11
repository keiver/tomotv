/**
 * Memory pressure: the ring's neighbours and the focused card's warm session are released on the
 * memoryWarning event; the playing session is never theirs to touch.
 */
import { AppState } from "react-native";

import { stopLocalRemux } from "@/services/localRemux";

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

jest.mock("@keiver/tomo-live/src/openFailures", () => ({
  noteOpenFailed: jest.fn(),
  openRecentlyFailed: jest.fn(() => false),
}));
jest.mock("@/services/jellyfinApi", () => ({
  resolveChannel: jest.fn((id: string) => Promise.resolve({ Id: id, Name: id, LiveStreamId: `ls-${id}`, liveStreamUrl: `https://origin/${id}.m3u8` })),
  resolveChannelWithoutOpen: jest.fn((id: string) => Promise.resolve({ Id: id, Name: id, liveStreamUrl: `https://origin/${id}.ts` })),
  closeLiveStream: jest.fn(() => Promise.resolve()),
}));

const mockThroughput = new Map<string, () => void>();
jest.mock("@keiver/tomo-engine", () => ({
  ...jest.requireActual("@keiver/tomo-engine"),
  stopLocalRemux: jest.fn(() => Promise.resolve()),
  localRemuxToken: (url: string | null) => url?.split("/").at(-2) ?? null,
  setLiveWindow: jest.fn(() => Promise.resolve()),
  setLiveSessionPriority: jest.fn(() => Promise.resolve()),
  subscribeEngineThroughput: jest.fn((token: string, listener: () => void) => {
    mockThroughput.set(token, listener);
    return jest.fn();
  }),
  subscribeEngineFailure: jest.fn(() => jest.fn()),
}));
jest.mock("@/services/localRemux", () => ({
  ...jest.requireMock("@keiver/tomo-engine"),
  canRemuxLocally: jest.fn(() => Promise.resolve(true)),
  startLocalRemux: jest.fn((details: { Id: string }) => Promise.resolve(`http://127.0.0.1:1/${details.Id}-s/master.m3u8`)),
}));

import { isHotChannel, recenterLiveRing, releaseLiveRing } from "@/services/liveRing";
import { showLivePreview, stopLivePreview, takeLivePreview } from "@/services/livePreview";

const RING = Array.from({ length: 10 }, (_, i) => ({ Id: `c${i}` }));
const flush = async () => {
  for (let hop = 0; hop < 12; hop++) await Promise.resolve();
};
const memoryWarnings = () => (AppState.addEventListener as jest.Mock).mock.calls.filter(([type]) => type === "memoryWarning").map(([, listener]) => listener as () => void);

describe("live surfaces under memory pressure", () => {
  afterEach(async () => {
    stopLivePreview();
    await releaseLiveRing();
  });

  it("releases every hot neighbour on a memory warning", async () => {
    recenterLiveRing(RING, "c5", true);
    await flush();
    mockThroughput.get("c6-s")!();
    mockThroughput.get("c6-s")!();
    expect(isHotChannel("c6")).toBe(true);

    for (const warn of memoryWarnings()) warn();

    expect(stopLocalRemux).toHaveBeenCalledWith("c6-s");
    expect(stopLocalRemux).toHaveBeenCalledWith("c4-s");
    expect(isHotChannel("c6")).toBe(false);
  });

  it("ends the focused card's warm session on a memory warning", async () => {
    showLivePreview("c1");
    await flush();

    for (const warn of memoryWarnings()) warn();

    expect(stopLocalRemux).toHaveBeenCalledWith("c1-s");
    expect(takeLivePreview("c1")).toBeNull();
  });
});
