import { cachedRequest, clearRequestCache, invalidateByPrefix, invalidateRequest } from "@/services/requestCache";

describe("requestCache", () => {
  beforeEach(() => {
    clearRequestCache();
    jest.restoreAllMocks();
  });

  it("serves a fresh cached value without re-invoking the fetcher", async () => {
    const fetcher = jest.fn().mockResolvedValue("v1");

    const first = await cachedRequest("k", fetcher, 1000);
    const second = await cachedRequest("k", fetcher, 1000);

    expect(first).toBe("v1");
    expect(second).toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches once the entry is older than its TTL", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1000);
    const fetcher = jest.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");

    expect(await cachedRequest("k", fetcher, 100)).toBe("v1");

    nowSpy.mockReturnValue(1050); // still within TTL
    expect(await cachedRequest("k", fetcher, 100)).toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(1200); // past TTL
    expect(await cachedRequest("k", fetcher, 100)).toBe("v2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("dedups concurrent calls for the same key onto one fetcher invocation", async () => {
    let resolve!: (value: string) => void;
    const fetcher = jest.fn(() => new Promise<string>((r) => (resolve = r)));

    const p1 = cachedRequest("k", fetcher, 1000);
    const p2 = cachedRequest("k", fetcher, 1000);

    expect(fetcher).toHaveBeenCalledTimes(1);

    resolve("v1");
    expect(await p1).toBe("v1");
    expect(await p2).toBe("v1");
  });

  it("does not cache a rejected fetch — the next call retries", async () => {
    const fetcher = jest.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("v1");

    await expect(cachedRequest("k", fetcher, 1000)).rejects.toThrow("boom");
    expect(await cachedRequest("k", fetcher, 1000)).toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidateRequest drops a single key", async () => {
    const fetcher = jest.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");

    await cachedRequest("k", fetcher, 1000);
    invalidateRequest("k");

    expect(await cachedRequest("k", fetcher, 1000)).toBe("v2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not re-cache a value that was invalidated while its fetch was in flight", async () => {
    let resolve!: (value: string) => void;
    const fetcher = jest
      .fn()
      .mockImplementationOnce(() => new Promise<string>((r) => (resolve = r)))
      .mockResolvedValueOnce("fresh");

    const inflight = cachedRequest("k", fetcher, 1000);
    invalidateRequest("k"); // invalidated before the in-flight fetch resolves
    resolve("stale");
    expect(await inflight).toBe("stale"); // the awaiting caller still gets its result

    // ...but the stale value must NOT land in the cache — the next read refetches.
    expect(await cachedRequest("k", fetcher, 1000)).toBe("fresh");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidateByPrefix drops only the keys that start with the prefix", async () => {
    const folder1 = jest.fn().mockResolvedValue("a");
    const folder2 = jest.fn().mockResolvedValue("b");
    const resume = jest.fn().mockResolvedValue("c");

    await cachedRequest("folder:u:1", folder1, 1000);
    await cachedRequest("folder:u:2", folder2, 1000);
    await cachedRequest("resume:u", resume, 1000);

    invalidateByPrefix("folder:u:");

    await cachedRequest("folder:u:1", folder1, 1000); // evicted → refetch
    await cachedRequest("resume:u", resume, 1000); // untouched → served from cache

    expect(folder1).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("clearRequestCache drops every entry", async () => {
    const fetcher = jest.fn().mockResolvedValue("v");

    await cachedRequest("k", fetcher, 1000);
    clearRequestCache();
    await cachedRequest("k", fetcher, 1000);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
