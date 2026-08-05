import { classifyPlaybackError, getLoadErrorMessage, isConnectivityError, PlaybackErrorType } from "../errorClassification";

describe("errorClassification", () => {
  describe("getLoadErrorMessage", () => {
    // The exact strings the Expo fetch layer produces when a server drops off the network.
    const rawNativeErrors = [
      new Error("fetch failed: UnexpectedException: Could not connect to the server. (at ExpoModulesCore/Promise.swift:56)"),
      new Error("fetch failed: FetchRequestCanceledException: Fetch request has been canceled (at Expo/NativeResponse.swift:63)"),
      new Error("Network request failed"),
      new Error("The operation was aborted"),
    ];

    it.each(rawNativeErrors.map((e) => [e.message, e]))("never leaks technical text for %s", (_label, error) => {
      const message = getLoadErrorMessage(error);
      expect(message).not.toMatch(/swift|exception|fetch|\.ts|\(at /i);
    });

    it("maps unreachable-server errors to the connection message", () => {
      expect(getLoadErrorMessage(new Error("fetch failed: UnexpectedException: Could not connect to the server. (at ExpoModulesCore/Promise.swift:56)"))).toBe(
        "Unable to connect to your Jellyfin server",
      );
    });

    it("maps canceled/aborted requests to the timeout message", () => {
      expect(getLoadErrorMessage(new Error("fetch failed: FetchRequestCanceledException: Fetch request has been canceled (at Expo/NativeResponse.swift:63)"))).toBe(
        "Connection timed out. Check your network.",
      );
    });

    it("maps 401 responses to the auth message", () => {
      expect(getLoadErrorMessage(new Error("Request failed: 401"))).toBe("Authentication failed. Your session may have expired.");
    });

    it("maps 404 responses to the not-found message", () => {
      expect(getLoadErrorMessage(new Error("Item not found"))).toBe("The server couldn't find this content");
    });

    it("falls back to a generic message for unknown errors", () => {
      expect(getLoadErrorMessage(new Error("something exotic"))).toBe("Something went wrong loading your library");
      expect(getLoadErrorMessage(undefined)).toBe("Something went wrong loading your library");
    });
  });

  describe("isConnectivityError", () => {
    it("is true for network and timeout errors", () => {
      expect(isConnectivityError(new Error("fetch failed: Could not connect to the server."))).toBe(true);
      expect(isConnectivityError(new Error("Request timed out"))).toBe(true);
    });

    it("is false for data errors", () => {
      expect(isConnectivityError(new Error("Item not found"))).toBe(false);
      expect(isConnectivityError(new Error("401 unauthorized"))).toBe(false);
    });
  });

  describe("classifyPlaybackError", () => {
    it("keeps the CoreMedia decode mapping", () => {
      expect(classifyPlaybackError({ code: -12971, domain: "CoreMediaErrorDomain" })).toBe(PlaybackErrorType.DECODE);
    });
  });
});
