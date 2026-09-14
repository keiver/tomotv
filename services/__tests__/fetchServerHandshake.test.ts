/**
 * A refused handshake ends a request now: a data read the way its timeout would, a server probe
 * as unreachable. A request whose server accepts runs to its own answer.
 */
import { fetchWithTimeout } from "../jellyfin/http";
import { checkServerInfo, ProbeError } from "../jellyfin/connection";

let mockRefuse = false;
const mockStops: jest.Mock[] = [];
jest.mock("@/services/serverHandshake", () => ({
  watchServerHandshake: (_url: string, onRefused: () => void) => {
    if (mockRefuse) queueMicrotask(onRefused);
    const stop = jest.fn();
    mockStops.push(stop);
    return stop;
  },
}));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn().mockResolvedValue(null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock("@/services/libraryManager", () => ({ libraryManager: { clearCache: jest.fn() } }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

/** A fetch that answers only through its abort signal, or after `answerMs`. */
function hangingFetch(answerMs?: number) {
  return jest.fn(
    (_url: string, init: { signal: AbortSignal }) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })));
        if (answerMs !== undefined) setTimeout(() => resolve({ ok: true, json: async () => ({ ServerName: "veguitas", Version: "12.0.0", Id: "s1" }) }), answerMs);
      }),
  );
}

beforeEach(() => {
  mockRefuse = false;
  mockStops.length = 0;
});

describe("fetchWithTimeout", () => {
  it("ends the request when the server refuses the handshake, as its timeout would", async () => {
    mockRefuse = true;
    global.fetch = hangingFetch() as never;
    const started = Date.now();
    await expect(fetchWithTimeout("http://192.168.1.5:8096/Items", {}, 30_000)).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(mockStops[0]).toHaveBeenCalled();
  });

  it("carries the caller's timeout wording on that path", async () => {
    mockRefuse = true;
    global.fetch = hangingFetch() as never;
    await expect(fetchWithTimeout("http://192.168.1.5:8096/Items", {}, 30_000, "Request timed out.")).rejects.toThrow("Request timed out.");
  });

  it("lets a request whose server accepts run to its answer, and stops watching after it", async () => {
    global.fetch = hangingFetch(20) as never;
    const response = await fetchWithTimeout("http://192.168.1.5:8096/Items", {}, 30_000);
    expect(response.ok).toBe(true);
    expect(mockStops[0]).toHaveBeenCalled();
  });
});

describe("checkServerInfo", () => {
  it("names a refused handshake unreachable, not a timeout", async () => {
    mockRefuse = true;
    global.fetch = hangingFetch() as never;
    const failure = await checkServerInfo("http://192.168.1.5:8096", 5_000).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProbeError);
    expect((failure as ProbeError).reason).toBe("unreachable");
    expect(mockStops[0]).toHaveBeenCalled();
  });

  it("validates a server that accepts", async () => {
    global.fetch = hangingFetch(20) as never;
    await expect(checkServerInfo("http://192.168.1.5:8096", 5_000)).resolves.toMatchObject({ ServerName: "veguitas" });
    expect(mockStops[0]).toHaveBeenCalled();
  });
});
