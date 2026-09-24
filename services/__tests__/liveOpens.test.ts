/**
 * liveOpens: the tuner streams this app opened and has not closed, kept on disk across a kill.
 */
import { LIVE_OPENS_FILENAME, recordClose, recordedOpens, recordOpen, resetLiveOpens } from "../jellyfin/liveOpens";

jest.mock("expo-file-system", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    Paths: { document: "documents", cache: "caches" },
    File: class {
      private readonly key: string;
      constructor(dir: string, name: string) {
        this.key = `${dir}/${name}`;
      }
      get exists() {
        return store.has(this.key);
      }
      textSync() {
        return store.get(this.key) ?? "";
      }
      delete() {
        store.delete(this.key);
      }
      create() {
        store.set(this.key, "");
      }
      write(text: string) {
        store.set(this.key, text);
      }
    },
  };
});
jest.mock("react-native", () => ({ Platform: { isTV: false } }));
jest.mock("@/utils/logger", () => ({ logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
const mockFiles = (jest.requireMock("expo-file-system") as { __store: Map<string, string> }).__store;

const origin = { server: "http://server:8096", deviceId: "dev-1" };

describe("live opens", () => {
  beforeEach(() => {
    mockFiles.clear();
    resetLiveOpens();
  });

  it("records an open on disk and forgets it on close", () => {
    recordOpen("ls-1", origin);
    recordOpen("ls-2", origin);
    expect(JSON.parse(mockFiles.get(`documents/${LIVE_OPENS_FILENAME}`)!)).toEqual({ "ls-1": origin, "ls-2": origin });
    recordClose("ls-1");
    expect(recordedOpens()).toEqual({ "ls-2": origin });
    recordClose("ls-none");
    expect(recordedOpens()).toEqual({ "ls-2": origin });
  });

  it("reads what a previous run left behind", () => {
    mockFiles.set(`documents/${LIVE_OPENS_FILENAME}`, JSON.stringify({ "ls-9": origin }));
    expect(recordedOpens()).toEqual({ "ls-9": origin });
  });

  it("starts empty on an unreadable file", () => {
    mockFiles.set(`documents/${LIVE_OPENS_FILENAME}`, "{not json");
    expect(recordedOpens()).toEqual({});
  });
});
