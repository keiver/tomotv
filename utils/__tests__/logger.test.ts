import { logger, redactSecrets } from "../logger";

describe("redactSecrets", () => {
  it("strips the current ApiKey spelling", () => {
    expect(redactSecrets("http://s:8096/Videos/1/master.m3u8?ApiKey=abc123&MediaSourceId=1")).toBe("http://s:8096/Videos/1/master.m3u8?ApiKey=[redacted]&MediaSourceId=1");
  });

  it("strips the legacy api_key spelling", () => {
    expect(redactSecrets("http://s/Items?api_key=deadbeef")).toBe("http://s/Items?api_key=[redacted]");
  });

  it("keeps everything after the token intact", () => {
    // The key sits mid-query far more often than at the end, so stopping at & matters.
    expect(redactSecrets("a?ApiKey=secret&b=2&c=3")).toContain("&b=2&c=3");
  });

  it("redacts every occurrence, not just the first", () => {
    expect(redactSecrets("ApiKey=one ApiKey=two")).toBe("ApiKey=[redacted] ApiKey=[redacted]");
  });

  it("leaves strings without a token alone", () => {
    expect(redactSecrets("no secrets here")).toBe("no secrets here");
  });

  it("strips the Token= form of the MediaBrowser auth header", () => {
    expect(redactSecrets('MediaBrowser Client="Tomo TV", DeviceId="abc", Token="supersecret"')).toBe('MediaBrowser Client="Tomo TV", DeviceId="abc", Token="[redacted]"');
  });

  it("leaves the rest of the auth header intact", () => {
    // DeviceId is a correlation id worth keeping in a log; only the token goes.
    expect(redactSecrets('DeviceId="abc", Token="secret", Version="2.1.0"')).toContain('DeviceId="abc"');
  });
});

describe("Logger", () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("debug", () => {
    it("should log debug messages in development", () => {
      logger.debug("Test debug message", { key: "value" });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("DEBUG"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Test debug message"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("key"));
    });
  });

  describe("info", () => {
    it("should log info messages", () => {
      logger.info("Test info message", { service: "TestService" });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("INFO"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Test info message"));
    });
  });

  describe("warn", () => {
    it("should log warning messages", () => {
      logger.warn("Test warning", { code: "WARN001" });

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("WARN"));
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Test warning"));
    });
  });

  describe("error", () => {
    it("should log error messages with error object", () => {
      const error = new Error("Test error");
      logger.error("Operation failed", error, { operation: "fetchData" });

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("ERROR"));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Operation failed"));
      // Not the Error itself: it is flattened so the message and stack can be redacted.
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "Error", message: "Test error" }));
    });

    it("should log error messages without error object", () => {
      logger.error("Operation failed", undefined, { operation: "fetchData" });

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("ERROR"));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Operation failed"));
    });
  });

  describe("formatting", () => {
    it("should include timestamp in log messages", () => {
      logger.info("Test message");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
    });

    it("should format context as JSON", () => {
      logger.info("Test message", { key1: "value1", key2: "value2" });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"key1":"value1"'));
    });
  });

  describe("secret redaction", () => {
    it("redacts a token in the message itself", () => {
      logger.info("Stream URL http://s/master.m3u8?ApiKey=supersecret");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.not.stringContaining("supersecret"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("ApiKey=[redacted]"));
    });

    it("redacts a token nested in the context", () => {
      logger.info("Playing", { session: { url: "http://s/master.m3u8?ApiKey=supersecret" } });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.not.stringContaining("supersecret"));
    });

    it("redacts a token inside an array in the context", () => {
      logger.warn("Retrying", { urls: ["http://s/a?api_key=supersecret"] });

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.not.stringContaining("supersecret"));
    });

    it("redacts a token carried in the error argument", () => {
      // The error argument printed verbatim before, which is how a native error
      // quoting the stream URL would have logged the key in full.
      logger.error("Playback failed", new Error("Cannot open http://s/master.m3u8?ApiKey=supersecret"));

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("ApiKey=[redacted]") }));
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("supersecret") }));
    });

    it("redacts a token in a non-Error thrown value", () => {
      logger.warn("Rejected", { reason: "x" });
      logger.error("Rejected", { url: "http://s/a?ApiKey=supersecret" });

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("supersecret") }));
    });
  });
});
