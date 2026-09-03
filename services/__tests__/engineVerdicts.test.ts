/**
 * engineVerdicts — what the engine measured about a file on this device, remembered.
 */
import { clearVerdicts, recordTimeoutVerdict, recordVerdict, rememberedVerdict, sampleIsClean, verdictKey, VERDICTS_FILENAME } from "../engineVerdicts";

/** In-memory stand-in for the one file the store keeps; the map rides the mock so the hoisted factory owns it. */
jest.mock("expo-file-system", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    Paths: { document: "documents" },
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
const mockFiles = (jest.requireMock("expo-file-system") as { __store: Map<string, string> }).__store;

jest.mock("@/services/jellyfinApi", () => ({ getConfig: async () => ({ server: "http://server:8096" }) }));
jest.mock("@/constants/app", () => ({ APP_BUILD_LABEL: "9.9.9 (1)" }));

const item = { Id: "abc", MediaSources: [{ Id: "ms1" }] } as Parameters<typeof rememberedVerdict>[0];
const slow = { produceSeconds: 9, segmentSeconds: 6, thermal: "nominal" };

beforeEach(() => {
  mockFiles.clear();
  clearVerdicts();
});

describe("engineVerdicts", () => {
  it("keys on server, item and media source: item ids repeat across servers", () => {
    expect(verdictKey("http://a", item)).toBe("http://a:abc:ms1");
    expect(verdictKey("http://b", item)).not.toBe(verdictKey("http://a", item));
    expect(verdictKey("http://a", { Id: "abc" })).toBe("http://a:abc:");
  });

  it("keeps only clean samples: timed, cool, nothing else on the cores", () => {
    expect(sampleIsClean(slow, false)).toBe(true);
    expect(sampleIsClean({ ...slow, thermal: "fair" }, false)).toBe(true);
    expect(sampleIsClean({ ...slow, thermal: "serious" }, false)).toBe(false);
    expect(sampleIsClean(slow, true)).toBe(false);
    expect(sampleIsClean({ segmentSeconds: 6, thermal: "nominal" }, false)).toBe(false);
  });

  it("remembers a recorded verdict and writes it to the file", async () => {
    await expect(rememberedVerdict(item)).resolves.toBeNull();
    await expect(recordVerdict(item, slow, "below realtime at start", { busy: false })).resolves.toBe(true);
    const verdict = await rememberedVerdict(item);
    expect(verdict).toMatchObject({ app: "9.9.9 (1)", reason: "below realtime at start", produceSeconds: 9, segmentSeconds: 6, thermal: "nominal" });
    expect(mockFiles.get(`documents/${VERDICTS_FILENAME}`)).toContain("http://server:8096:abc:ms1");
  });

  it("does not record a sample taken under load, and does not remember one", async () => {
    await expect(recordVerdict(item, { ...slow, thermal: "serious" }, "x", { busy: false })).resolves.toBe(false);
    await expect(recordVerdict(item, slow, "x", { busy: true })).resolves.toBe(false);
    await expect(rememberedVerdict(item)).resolves.toBeNull();
  });

  it("ignores a verdict another app build recorded", async () => {
    mockFiles.set(
      `documents/${VERDICTS_FILENAME}`,
      JSON.stringify({ "http://server:8096:abc:ms1": { app: "1.0.0 (1)", at: 1, reason: "x", produceSeconds: 9, segmentSeconds: 6, thermal: "nominal" } }),
    );
    // A fresh module reads the file once; this suite's cache was emptied by clearVerdicts above,
    // so reload through the same path the app takes.
    jest.resetModules();
    const fresh = require("../engineVerdicts") as typeof import("../engineVerdicts");
    await expect(fresh.rememberedVerdict(item)).resolves.toBeNull();
  });

  it("remembers a session that produced no segment within the deadline, unless a repackage ran", async () => {
    await expect(recordTimeoutVerdict(item, 20, { busy: true })).resolves.toBe(false);
    await expect(rememberedVerdict(item)).resolves.toBeNull();
    await expect(recordTimeoutVerdict(item, 20, { busy: false })).resolves.toBe(true);
    await expect(rememberedVerdict(item)).resolves.toMatchObject({ reason: "no segment within 20s", produceSeconds: 20, segmentSeconds: 0, thermal: "unknown" });
  });

  it("clearVerdicts empties the store and the file", async () => {
    await recordVerdict(item, slow, "x", { busy: false });
    clearVerdicts();
    await expect(rememberedVerdict(item)).resolves.toBeNull();
    expect(mockFiles.get(`documents/${VERDICTS_FILENAME}`)).toBe("{}");
  });
});
