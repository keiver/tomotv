import { fetchRecursiveVideos, fetchPlaylistContents } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

type PlayQueueListener = (data: { queue: JellyfinVideoItem[]; currentIndex: number; isLoading: boolean; sourceFolderId: string | null }) => void;

/**
 * Singleton service for managing the auto-play queue
 * Follows the same singleton + subscribe/notify pattern as LibraryManager
 */
class PlayQueueManager {
  private static instance: PlayQueueManager;

  private queue: JellyfinVideoItem[] = [];
  private currentIndex: number = -1;
  private isLoading: boolean = false;
  private sourceFolderId: string | null = null;

  private listeners: Set<PlayQueueListener> = new Set();

  private constructor() {}

  static getInstance(): PlayQueueManager {
    if (!PlayQueueManager.instance) {
      PlayQueueManager.instance = new PlayQueueManager();
    }
    return PlayQueueManager.instance;
  }

  subscribe(listener: PlayQueueListener): () => void {
    this.listeners.add(listener);

    logger.debug("Play queue subscriber added", {
      service: "PlayQueueManager",
      totalSubscribers: this.listeners.size,
    });

    listener(this.getState());

    return () => {
      this.listeners.delete(listener);
      logger.debug("Play queue subscriber removed", {
        service: "PlayQueueManager",
        totalSubscribers: this.listeners.size,
      });
    };
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  getState() {
    return {
      queue: this.queue,
      currentIndex: this.currentIndex,
      isLoading: this.isLoading,
      sourceFolderId: this.sourceFolderId,
    };
  }

  /**
   * Build a play queue from all videos recursively under a folder
   * Finds the startVideoId in the results and sets it as current
   *
   * @param folderId - The folder to fetch videos from
   * @param folderName - Display name for logging
   * @param startVideoId - The video the user tapped (queue starts here)
   * @param folderType - "folder" or "playlist" to use correct API
   */
  async buildQueue(folderId: string, folderName: string, startVideoId: string, folderType: "folder" | "playlist" = "folder"): Promise<void> {
    logger.info("Building play queue", {
      service: "PlayQueueManager",
      folderId,
      folderName,
      startVideoId,
      folderType,
    });

    this.isLoading = true;
    this.sourceFolderId = folderId;
    this.notifyListeners();

    try {
      let items: JellyfinVideoItem[];

      if (folderType === "playlist") {
        // Playlists are flat — fetch all items via playlist API
        const result = await fetchPlaylistContents(folderId, { limit: 500, startIndex: 0 });
        items = result.items as JellyfinVideoItem[];
      } else {
        items = await fetchRecursiveVideos(folderId);
      }

      if (items.length === 0) {
        logger.warn("No videos found for queue", {
          service: "PlayQueueManager",
          folderId,
          folderName,
        });
        this.queue = [];
        this.currentIndex = -1;
        this.isLoading = false;
        this.notifyListeners();
        return;
      }

      // Find the index of the video the user tapped
      const startIndex = items.findIndex((item) => item.Id === startVideoId);

      this.queue = items;
      this.currentIndex = startIndex >= 0 ? startIndex : 0;
      this.isLoading = false;
      this.notifyListeners();

      logger.info("Play queue built", {
        service: "PlayQueueManager",
        totalVideos: items.length,
        startIndex: this.currentIndex,
        startVideoName: items[this.currentIndex]?.Name,
      });
    } catch (error) {
      logger.error("Failed to build play queue", error, {
        service: "PlayQueueManager",
        folderId,
        folderName,
      });
      this.queue = [];
      this.currentIndex = -1;
      this.isLoading = false;
      this.notifyListeners();
    }
  }

  /**
   * Advance to the next video in the queue
   * Returns the next video item, or null if at end
   */
  advanceToNext(): JellyfinVideoItem | null {
    if (!this.hasNext()) {
      return null;
    }

    this.currentIndex += 1;
    const next = this.queue[this.currentIndex];
    this.notifyListeners();

    logger.info("Advanced to next in queue", {
      service: "PlayQueueManager",
      index: this.currentIndex,
      videoName: next?.Name,
      progress: this.getProgress(),
    });

    return next || null;
  }

  /**
   * Check if there's a next video after the current one
   */
  hasNext(): boolean {
    return this.currentIndex >= 0 && this.currentIndex < this.queue.length - 1;
  }

  /**
   * Preview the next video without advancing
   */
  peekNext(): JellyfinVideoItem | null {
    if (!this.hasNext()) {
      return null;
    }
    return this.queue[this.currentIndex + 1] || null;
  }

  /**
   * Get human-readable progress string (e.g. "3 of 47")
   */
  getProgress(): string {
    if (this.queue.length === 0 || this.currentIndex < 0) {
      return "";
    }
    return `${this.currentIndex + 1} of ${this.queue.length}`;
  }

  /**
   * Clear the queue and reset all state
   */
  clear(): void {
    logger.info("Clearing play queue", {
      service: "PlayQueueManager",
      hadItems: this.queue.length,
    });

    this.queue = [];
    this.currentIndex = -1;
    this.isLoading = false;
    this.sourceFolderId = null;
    this.notifyListeners();
  }
}

export const playQueueManager = PlayQueueManager.getInstance();
