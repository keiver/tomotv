import { playQueueManager } from "../playQueueManager";
import * as jellyfinApi from "../jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";

jest.mock("../jellyfinApi");
jest.mock("@/utils/logger");

const mockFetchRecursiveVideos = jellyfinApi.fetchRecursiveVideos as jest.MockedFunction<typeof jellyfinApi.fetchRecursiveVideos>;
const mockFetchPlaylistContents = jellyfinApi.fetchPlaylistContents as jest.MockedFunction<typeof jellyfinApi.fetchPlaylistContents>;

describe("PlayQueueManager", () => {
  const mockVideos: JellyfinVideoItem[] = [
    {
      Id: "video1",
      Name: "Episode 1",
      Type: "Video",
      RunTimeTicks: 36000000000,
      Path: "/media/ep1.mp4",
    },
    {
      Id: "video2",
      Name: "Episode 2",
      Type: "Video",
      RunTimeTicks: 42000000000,
      Path: "/media/ep2.mp4",
    },
    {
      Id: "video3",
      Name: "Episode 3",
      Type: "Video",
      RunTimeTicks: 39000000000,
      Path: "/media/ep3.mp4",
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    playQueueManager.clear();

    mockFetchRecursiveVideos.mockResolvedValue(mockVideos);
    mockFetchPlaylistContents.mockResolvedValue({
      items: mockVideos,
      total: 3,
    });
  });

  describe("singleton pattern", () => {
    it("should return same instance", () => {
      const instance1 = playQueueManager;
      const instance2 = playQueueManager;
      expect(instance1).toBe(instance2);
    });
  });

  describe("buildQueue", () => {
    it("should fetch recursive videos and set queue", async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "video1");

      expect(mockFetchRecursiveVideos).toHaveBeenCalledWith("folder1");

      const state = playQueueManager.getState();
      expect(state.queue).toEqual(mockVideos);
      expect(state.currentIndex).toBe(0);
      expect(state.isLoading).toBe(false);
      expect(state.sourceFolderId).toBe("folder1");
    });

    it("should find startVideoId in results and set currentIndex", async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "video2");

      const state = playQueueManager.getState();
      expect(state.currentIndex).toBe(1); // video2 is at index 1
    });

    it("should default to index 0 if startVideoId not found", async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "nonexistent");

      const state = playQueueManager.getState();
      expect(state.currentIndex).toBe(0);
    });

    it("should use playlist API for playlist type", async () => {
      await playQueueManager.buildQueue("playlist1", "Favorites", "video1", "playlist");

      expect(mockFetchPlaylistContents).toHaveBeenCalledWith("playlist1", {
        limit: 500,
        startIndex: 0,
      });
      expect(mockFetchRecursiveVideos).not.toHaveBeenCalled();
    });

    it("should handle empty results", async () => {
      mockFetchRecursiveVideos.mockResolvedValueOnce([]);

      await playQueueManager.buildQueue("folder1", "Empty", "video1");

      const state = playQueueManager.getState();
      expect(state.queue).toEqual([]);
      expect(state.currentIndex).toBe(-1);
      expect(state.isLoading).toBe(false);
    });

    it("should handle fetch errors gracefully", async () => {
      mockFetchRecursiveVideos.mockRejectedValueOnce(new Error("Network error"));

      await playQueueManager.buildQueue("folder1", "Movies", "video1");

      const state = playQueueManager.getState();
      expect(state.queue).toEqual([]);
      expect(state.currentIndex).toBe(-1);
      expect(state.isLoading).toBe(false);
    });

    it("should set isLoading during fetch", async () => {
      let resolvePromise: (value: JellyfinVideoItem[]) => void;
      const promise = new Promise<JellyfinVideoItem[]>((resolve) => {
        resolvePromise = resolve;
      });
      mockFetchRecursiveVideos.mockReturnValue(promise);

      const buildPromise = playQueueManager.buildQueue("folder1", "Movies", "video1");

      // During fetch
      expect(playQueueManager.getState().isLoading).toBe(true);

      resolvePromise!(mockVideos);
      await buildPromise;

      // After fetch
      expect(playQueueManager.getState().isLoading).toBe(false);
    });
  });

  describe("buildQueueFromItems", () => {
    it("uses the provided items as the queue without fetching", () => {
      playQueueManager.buildQueueFromItems(mockVideos, "folder1", "Music Videos", "video2");

      expect(mockFetchRecursiveVideos).not.toHaveBeenCalled();
      expect(mockFetchPlaylistContents).not.toHaveBeenCalled();

      const state = playQueueManager.getState();
      expect(state.queue).toEqual(mockVideos);
      expect(state.currentIndex).toBe(1);
      expect(state.isLoading).toBe(false);
      expect(state.sourceFolderId).toBe("folder1");
    });

    it("falls back to index 0 when the start video is not in the list", () => {
      playQueueManager.buildQueueFromItems(mockVideos, "folder1", "Music Videos", "missing-id");

      expect(playQueueManager.getState().currentIndex).toBe(0);
    });

    it("notifies subscribers with the new queue", () => {
      const listener = jest.fn();
      playQueueManager.subscribe(listener);
      listener.mockClear();

      playQueueManager.buildQueueFromItems(mockVideos, "folder1", "Music Videos", "video1");

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          queue: mockVideos,
          currentIndex: 0,
        }),
      );
    });

    it("does not loop by default (stops at the end)", () => {
      playQueueManager.buildQueueFromItems(mockVideos, "folder1", "Music Videos", "video3"); // last item

      expect(playQueueManager.getState().loop).toBe(false);
      expect(playQueueManager.hasNext()).toBe(false);
      expect(playQueueManager.advanceToNext()).toBeNull();
    });
  });

  describe("loop (shuffle)", () => {
    it("wraps to the start at the end of the queue when loop is on", () => {
      playQueueManager.buildQueueFromItems(mockVideos, "folder1", "Music Videos", "video3", true); // last item, loop

      expect(playQueueManager.getState().loop).toBe(true);
      expect(playQueueManager.hasNext()).toBe(true);
      expect(playQueueManager.advanceToNext()).toEqual(mockVideos[0]);
      expect(playQueueManager.getState().currentIndex).toBe(0);
    });

    it("peekNext wraps to the first item at the end when looping", () => {
      playQueueManager.buildQueueFromItems(mockVideos, "folder1", "Music Videos", "video3", true);

      expect(playQueueManager.peekNext()).toEqual(mockVideos[0]);
    });

    it("loops a single-item queue back onto itself", () => {
      playQueueManager.buildQueueFromItems([mockVideos[0]], "folder1", "Music Videos", "video1", true);

      expect(playQueueManager.hasNext()).toBe(true);
      expect(playQueueManager.advanceToNext()).toEqual(mockVideos[0]);
    });

    it("clear() resets loop back to false", () => {
      playQueueManager.buildQueueFromItems(mockVideos, "folder1", "Music Videos", "video1", true);
      playQueueManager.clear();

      expect(playQueueManager.getState().loop).toBe(false);
    });
  });

  describe("advanceToNext", () => {
    beforeEach(async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "video1");
    });

    it("should advance to next video", () => {
      const next = playQueueManager.advanceToNext();

      expect(next).toEqual(mockVideos[1]);
      expect(playQueueManager.getState().currentIndex).toBe(1);
    });

    it("should return null when at end of queue", () => {
      playQueueManager.advanceToNext(); // -> video2 (index 1)
      playQueueManager.advanceToNext(); // -> video3 (index 2)
      const result = playQueueManager.advanceToNext(); // no next

      expect(result).toBeNull();
      expect(playQueueManager.getState().currentIndex).toBe(2); // still at last
    });
  });

  describe("hasNext", () => {
    it("should return true when not at end", async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "video1");

      expect(playQueueManager.hasNext()).toBe(true);
    });

    it("should return false at last item", async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "video3");

      expect(playQueueManager.hasNext()).toBe(false);
    });

    it("should return false when queue is empty", () => {
      expect(playQueueManager.hasNext()).toBe(false);
    });
  });

  describe("peekNext", () => {
    it("should return next video without advancing", async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "video1");

      const peeked = playQueueManager.peekNext();

      expect(peeked).toEqual(mockVideos[1]);
      expect(playQueueManager.getState().currentIndex).toBe(0); // unchanged
    });

    it("should return null at end of queue", async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "video3");

      expect(playQueueManager.peekNext()).toBeNull();
    });
  });

  describe("getProgress", () => {
    it("should return progress string", async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "video1");

      expect(playQueueManager.getProgress()).toBe("1 of 3");
    });

    it("should update after advance", async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "video1");
      playQueueManager.advanceToNext();

      expect(playQueueManager.getProgress()).toBe("2 of 3");
    });

    it("should return empty string when queue is empty", () => {
      expect(playQueueManager.getProgress()).toBe("");
    });
  });

  describe("clear", () => {
    it("should reset all state", async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "video1");

      playQueueManager.clear();

      const state = playQueueManager.getState();
      expect(state.queue).toEqual([]);
      expect(state.currentIndex).toBe(-1);
      expect(state.isLoading).toBe(false);
      expect(state.sourceFolderId).toBeNull();
    });
  });

  describe("subscribe", () => {
    it("should notify listener immediately with current state", () => {
      const listener = jest.fn();

      playQueueManager.subscribe(listener);

      expect(listener).toHaveBeenCalledWith({
        queue: [],
        currentIndex: -1,
        isLoading: false,
        sourceFolderId: null,
        loop: false,
      });
    });

    it("should notify on state changes", async () => {
      const listener = jest.fn();
      playQueueManager.subscribe(listener);
      listener.mockClear();

      await playQueueManager.buildQueue("folder1", "Movies", "video1");

      // Should have been called during loading + after completion
      expect(listener).toHaveBeenCalled();

      const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0];
      expect(lastCall.queue).toEqual(mockVideos);
      expect(lastCall.currentIndex).toBe(0);
      expect(lastCall.isLoading).toBe(false);
    });

    it("should return unsubscribe function", () => {
      const listener = jest.fn();
      const unsubscribe = playQueueManager.subscribe(listener);

      expect(typeof unsubscribe).toBe("function");

      unsubscribe();
      listener.mockClear();

      playQueueManager.clear();
      expect(listener).not.toHaveBeenCalled();
    });

    it("should notify on advanceToNext", async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "video1");

      const listener = jest.fn();
      playQueueManager.subscribe(listener);
      listener.mockClear();

      playQueueManager.advanceToNext();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          currentIndex: 1,
        }),
      );
    });

    it("should notify on clear", async () => {
      await playQueueManager.buildQueue("folder1", "Movies", "video1");

      const listener = jest.fn();
      playQueueManager.subscribe(listener);
      listener.mockClear();

      playQueueManager.clear();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          queue: [],
          currentIndex: -1,
        }),
      );
    });
  });
});
