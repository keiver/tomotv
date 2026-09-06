import { videoPlayerReducer, VideoPlayerState, classifyPlaybackError, getPlaybackErrorMessage, PlaybackErrorType } from "../useVideoPlayback";

describe("videoPlayerReducer", () => {
  const baseDetails = {
    Id: "1",
    Name: "Example",
  } as any;

  it("moves through happy-path states", () => {
    let state: VideoPlayerState = { type: "IDLE" };

    state = videoPlayerReducer(state, { type: "FETCH_METADATA" });
    expect(state).toEqual({ type: "FETCHING_METADATA" });

    state = videoPlayerReducer(state, {
      type: "METADATA_FETCHED",
      details: baseDetails,
      mode: "direct",
      hasSubtitles: false,
    });
    expect(state.type).toBe("CREATING_STREAM");

    state = videoPlayerReducer(state, {
      type: "STREAM_CREATED",
      streamUrl: "https://example/video",
    });
    expect(state).toEqual({ type: "INITIALIZING_PLAYER", mode: "direct", streamUrl: "https://example/video" });

    state = videoPlayerReducer(state, { type: "PLAYER_READY" });
    expect(state).toEqual({ type: "READY", mode: "direct" });

    state = videoPlayerReducer(state, { type: "PLAYER_PLAYING" });
    expect(state).toEqual({ type: "PLAYING", mode: "direct" });
  });

  // useReducer bails out of the render only on the identical reference, so RETRY into an
  // already-idle machine must hand back the state it was given.
  it("returns the same state object when RETRY lands on IDLE", () => {
    const idle: VideoPlayerState = { type: "IDLE" };
    expect(videoPlayerReducer(idle, { type: "RETRY" })).toBe(idle);
  });

  it("resets to IDLE when RETRY lands on a session in flight", () => {
    const playing: VideoPlayerState = { type: "PLAYING", mode: "localRemux" };
    const next = videoPlayerReducer(playing, { type: "RETRY" });
    expect(next).toEqual({ type: "IDLE" });
    expect(next).not.toBe(playing);
  });

  // The transition log reads `to` as the state produced; an action a guard rejects must not
  // be reported as a move that happened.
  it("leaves a guarded action's state untouched", () => {
    const idle: VideoPlayerState = { type: "IDLE" };
    expect(videoPlayerReducer(idle, { type: "PLAYER_READY" })).toBe(idle);
    expect(videoPlayerReducer(idle, { type: "STREAM_CREATED", streamUrl: "https://example/v" })).toBe(idle);
    expect(videoPlayerReducer(idle, { type: "PLAYER_PLAYING" })).toBe(idle);
  });

  it("surfaces retry flag when direct play fails before transcoding", () => {
    const errorState = videoPlayerReducer(
      { type: "CREATING_STREAM", mode: "direct", details: baseDetails, hasSubtitles: false },
      {
        type: "PLAYER_ERROR",
        error: { message: "codec not supported" },
        mode: "direct",
        hasTriedTranscode: false,
      },
    );

    expect(errorState).toEqual({
      type: "ERROR",
      error: "codec not supported",
      canRetryWithTranscode: true,
    });
  });

  it("stays in error without retry when already transcoding", () => {
    const errorState = videoPlayerReducer(
      { type: "READY", mode: "transcode" },
      {
        type: "PLAYER_ERROR",
        error: { message: "transcode server down" },
        mode: "transcode",
        hasTriedTranscode: true,
      },
    );

    expect(errorState).toEqual({
      type: "ERROR",
      error: "transcode server down",
      canRetryWithTranscode: false,
    });
  });
});

describe("error classification", () => {
  describe("classifyPlaybackError", () => {
    it("should classify NOT_FOUND errors", () => {
      expect(classifyPlaybackError(new Error("404 Not Found"))).toBe(PlaybackErrorType.NOT_FOUND);
      expect(classifyPlaybackError(new Error("Video not found on server"))).toBe(PlaybackErrorType.NOT_FOUND);
      expect(classifyPlaybackError(new Error("Item does not exist"))).toBe(PlaybackErrorType.NOT_FOUND);
    });

    it("should classify TIMEOUT errors", () => {
      expect(classifyPlaybackError(new Error("Request timed out"))).toBe(PlaybackErrorType.TIMEOUT);
      expect(classifyPlaybackError(new Error("Connection timeout"))).toBe(PlaybackErrorType.TIMEOUT);
      expect(classifyPlaybackError(new Error("ETIMEDOUT"))).toBe(PlaybackErrorType.TIMEOUT);
    });

    it("should classify CORRUPT errors", () => {
      expect(classifyPlaybackError(new Error("HostFunction error"))).toBe(PlaybackErrorType.CORRUPT);
      expect(classifyPlaybackError(new Error("Video file is corrupted"))).toBe(PlaybackErrorType.CORRUPT);
      expect(classifyPlaybackError(new Error("Invalid video format"))).toBe(PlaybackErrorType.CORRUPT);
      expect(classifyPlaybackError(new Error("Invalid data in stream"))).toBe(PlaybackErrorType.CORRUPT);
    });

    it("should classify DECODE errors", () => {
      expect(classifyPlaybackError(new Error("Failed to decode video"))).toBe(PlaybackErrorType.DECODE);
      expect(classifyPlaybackError(new Error("Codec not supported"))).toBe(PlaybackErrorType.DECODE);
      expect(classifyPlaybackError(new Error("Unable to play this video"))).toBe(PlaybackErrorType.DECODE);
    });

    it("should classify UNAUTHORIZED errors", () => {
      expect(classifyPlaybackError(new Error("Unauthorized access"))).toBe(PlaybackErrorType.UNAUTHORIZED);
      expect(classifyPlaybackError(new Error("HTTP 401 error"))).toBe(PlaybackErrorType.UNAUTHORIZED);
      expect(classifyPlaybackError(new Error("Not authorized to access this resource"))).toBe(PlaybackErrorType.UNAUTHORIZED);
      expect(classifyPlaybackError(new Error("Authentication failed"))).toBe(PlaybackErrorType.UNAUTHORIZED);
      expect(classifyPlaybackError(new Error("Invalid credentials provided"))).toBe(PlaybackErrorType.UNAUTHORIZED);
      expect(classifyPlaybackError(new Error("NSURLErrorDomain error -1013"))).toBe(PlaybackErrorType.UNAUTHORIZED);
    });

    it("should classify NETWORK errors", () => {
      expect(classifyPlaybackError(new Error("Network error occurred"))).toBe(PlaybackErrorType.NETWORK);
      expect(classifyPlaybackError(new Error("Network failure"))).toBe(PlaybackErrorType.NETWORK);
      expect(classifyPlaybackError(new Error("Fetch error"))).toBe(PlaybackErrorType.NETWORK);
      expect(classifyPlaybackError(new Error("Connection refused"))).toBe(PlaybackErrorType.NETWORK);
      expect(classifyPlaybackError(new Error("Connection reset"))).toBe(PlaybackErrorType.NETWORK);
      expect(classifyPlaybackError(new Error("ECONNRESET"))).toBe(PlaybackErrorType.NETWORK);
      expect(classifyPlaybackError(new Error("ECONNREFUSED"))).toBe(PlaybackErrorType.NETWORK);
      expect(classifyPlaybackError(new Error("Unable to connect to server"))).toBe(PlaybackErrorType.NETWORK);
    });

    it("should default to UNKNOWN for unrecognized errors", () => {
      expect(classifyPlaybackError(new Error("Something unexpected happened"))).toBe(PlaybackErrorType.UNKNOWN);
      expect(classifyPlaybackError(new Error("Random error message"))).toBe(PlaybackErrorType.UNKNOWN);
    });

    it("should handle non-Error objects", () => {
      expect(classifyPlaybackError("404 Not Found")).toBe(PlaybackErrorType.NOT_FOUND);
      expect(classifyPlaybackError("Network error")).toBe(PlaybackErrorType.NETWORK);
      expect(classifyPlaybackError(null)).toBe(PlaybackErrorType.UNKNOWN);
      expect(classifyPlaybackError(undefined)).toBe(PlaybackErrorType.UNKNOWN);
    });

    it("should handle plain objects with message property", () => {
      // This is the critical case - react-native-video returns errors as plain objects
      expect(
        classifyPlaybackError({
          message: "Failed to load the player item: The operation couldn't be completed. (NSURLErrorDomain error -1013.)",
        }),
      ).toBe(PlaybackErrorType.UNAUTHORIZED);

      expect(classifyPlaybackError({ message: "Video not found" })).toBe(PlaybackErrorType.NOT_FOUND);
      expect(classifyPlaybackError({ message: "Network error occurred" })).toBe(PlaybackErrorType.NETWORK);
      expect(classifyPlaybackError({ message: "Request timed out" })).toBe(PlaybackErrorType.TIMEOUT);
      expect(classifyPlaybackError({ message: "Unauthorized access" })).toBe(PlaybackErrorType.UNAUTHORIZED);
    });
  });

  describe("getPlaybackErrorMessage", () => {
    it("should return user-friendly message for NOT_FOUND", () => {
      const message = getPlaybackErrorMessage(PlaybackErrorType.NOT_FOUND);
      expect(message).toBe("Video not found on server");
    });

    it("should return user-friendly message for UNAUTHORIZED", () => {
      const message = getPlaybackErrorMessage(PlaybackErrorType.UNAUTHORIZED);
      expect(message).toBe("Authentication failed. Your session may have expired.");
    });

    it("should return user-friendly message for NETWORK", () => {
      const message = getPlaybackErrorMessage(PlaybackErrorType.NETWORK);
      expect(message).toBe("Unable to connect to Jellyfin server");
    });

    it("should return user-friendly message for TIMEOUT", () => {
      const message = getPlaybackErrorMessage(PlaybackErrorType.TIMEOUT);
      expect(message).toBe("Connection timed out. Please check your network");
    });

    it("should return user-friendly message for CORRUPT", () => {
      const message = getPlaybackErrorMessage(PlaybackErrorType.CORRUPT);
      expect(message).toBe("This video file appears to be corrupted or in an unsupported format");
    });

    it("should return user-friendly message for DECODE", () => {
      const message = getPlaybackErrorMessage(PlaybackErrorType.DECODE);
      expect(message).toBe("Unable to decode video. Try a different quality setting");
    });

    it("should return generic message for UNKNOWN", () => {
      const message = getPlaybackErrorMessage(PlaybackErrorType.UNKNOWN);
      expect(message).toBe("Failed to load video");
    });
  });

  describe("error recovery", () => {
    it("should retry with transcoding on DECODE error from direct play", () => {
      let state: VideoPlayerState = {
        type: "CREATING_STREAM",
        mode: "direct",
        details: { Id: "1", Name: "Video" } as any,
        hasSubtitles: false,
      };

      state = videoPlayerReducer(state, {
        type: "PLAYER_ERROR",
        error: { message: "Codec not supported" },
        mode: "direct",
        hasTriedTranscode: false,
      });

      expect(state.type).toBe("ERROR");
      expect(state).toHaveProperty("canRetryWithTranscode", true);
    });

    it("should not retry if already tried transcoding", () => {
      let state: VideoPlayerState = {
        type: "READY",
        mode: "transcode",
      };

      state = videoPlayerReducer(state, {
        type: "PLAYER_ERROR",
        error: { message: "Transcode failed" },
        mode: "transcode",
        hasTriedTranscode: true,
      });

      expect(state.type).toBe("ERROR");
      expect(state).toHaveProperty("canRetryWithTranscode", false);
    });

    it("should not allow transcode retry when already in transcode mode (seek recovery is hook-level)", () => {
      let state: VideoPlayerState = {
        type: "PLAYING",
        mode: "transcode",
      };

      state = videoPlayerReducer(state, {
        type: "PLAYER_ERROR",
        error: { message: "CoreMediaErrorDomain error -15628" },
        mode: "transcode",
        hasTriedTranscode: true,
      });

      expect(state.type).toBe("ERROR");
      expect(state).toHaveProperty("canRetryWithTranscode", false);
    });

    it("should set error state for non-retryable errors", () => {
      let state: VideoPlayerState = {
        type: "READY",
        mode: "direct",
      };

      state = videoPlayerReducer(state, {
        type: "PLAYER_ERROR",
        error: { message: "Video not found" },
        mode: "direct",
        hasTriedTranscode: false,
      });

      expect(state.type).toBe("ERROR");
      if (state.type === "ERROR") {
        expect(state.error).toBe("Video not found");
      }
    });
  });
});
