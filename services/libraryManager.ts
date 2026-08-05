import { CACHE } from "@/constants/app";
import { attemptConnectionRecovery } from "@/services/connectionRecovery";
import { fetchLibraryName, fetchLibraryVideos } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { getLoadErrorMessage, isConnectivityError } from "@/utils/errorClassification";
import { logger } from "@/utils/logger";

type LibraryListener = (data: { videos: JellyfinVideoItem[]; isLoading: boolean; isLoadingMore: boolean; hasMoreResults: boolean; error: string | null; libraryName: string }) => void;

/**
 * Singleton service for managing library data with pagination support
 * Handles caching, deduplication, and state updates
 */
class LibraryManager {
  private static instance: LibraryManager;

  private videos: JellyfinVideoItem[] = [];
  private libraryName: string = "";
  private isLoading: boolean = false;
  private isLoadingMore: boolean = false;
  private hasMoreResults: boolean = false;
  private error: string | null = null;

  private nextStartIndex: number = 0;
  private totalRecordCount: number | undefined = undefined;
  private isLoadingRef: boolean = false;
  private lastFetchTime: number = 0;
  private libraryNameLoaded: boolean = false;

  private listeners: Set<LibraryListener> = new Set();

  private readonly CACHE_TTL = CACHE.DEFAULT_TTL_MS;
  private readonly PAGE_SIZE = 60;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): LibraryManager {
    if (!LibraryManager.instance) {
      LibraryManager.instance = new LibraryManager();
    }
    return LibraryManager.instance;
  }

  /**
   * Subscribe to library state changes
   */
  subscribe(listener: LibraryListener): () => void {
    this.listeners.add(listener);

    logger.debug("New subscriber added", {
      service: "LibraryManager",
      totalSubscribers: this.listeners.size,
      currentState: {
        videoCount: this.videos.length,
        isLoading: this.isLoading,
        isLoadingMore: this.isLoadingMore,
        hasMoreResults: this.hasMoreResults,
        hasError: !!this.error,
      },
    });

    // Immediately notify with current state
    listener({
      videos: this.videos,
      isLoading: this.isLoading,
      isLoadingMore: this.isLoadingMore,
      hasMoreResults: this.hasMoreResults,
      error: this.error,
      libraryName: this.libraryName,
    });

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
      logger.debug("Subscriber removed", {
        service: "LibraryManager",
        totalSubscribers: this.listeners.size,
      });
    };
  }

  /**
   * Notify all listeners of state changes
   */
  private notifyListeners() {
    const state = {
      videos: this.videos,
      isLoading: this.isLoading,
      isLoadingMore: this.isLoadingMore,
      hasMoreResults: this.hasMoreResults,
      error: this.error,
      libraryName: this.libraryName,
    };

    logger.debug("Notifying listeners", {
      service: "LibraryManager",
      listenerCount: this.listeners.size,
      videoCount: state.videos.length,
      isLoading: state.isLoading,
      isLoadingMore: state.isLoadingMore,
      hasMoreResults: state.hasMoreResults,
      hasError: !!state.error,
      libraryName: state.libraryName,
    });

    this.listeners.forEach((listener) => listener(state));
  }

  /**
   * Get current state (synchronous)
   */
  getState() {
    return {
      videos: this.videos,
      isLoading: this.isLoading,
      isLoadingMore: this.isLoadingMore,
      hasMoreResults: this.hasMoreResults,
      error: this.error,
      libraryName: this.libraryName,
    };
  }

  /**
   * Load library name (cached, but can be forced to reload)
   */
  private async loadLibraryName(force = false): Promise<void> {
    if (!force && this.libraryNameLoaded) {
      return;
    }

    try {
      const name = await fetchLibraryName();
      this.libraryName = name;
      this.libraryNameLoaded = true;
      this.notifyListeners();
    } catch (err) {
      logger.error("Error loading library name", err, {
        service: "LibraryManager",
      });
      this.libraryName = "JELLYFIN";
    }
  }

  /**
   * Load initial page of library data
   */
  async loadLibrary(force = false): Promise<void> {
    // Prevent duplicate loads
    if (this.isLoadingRef) {
      logger.debug("Already loading library, ignoring duplicate call", {
        service: "LibraryManager",
      });
      return;
    }

    // Check cache TTL
    const now = Date.now();
    const cacheAge = now - this.lastFetchTime;
    if (!force && cacheAge < this.CACHE_TTL && this.videos.length > 0) {
      logger.debug("Using cached library data", {
        service: "LibraryManager",
        cacheAge: Math.round(cacheAge / 1000),
        videoCount: this.videos.length,
      });
      return;
    }

    try {
      this.isLoadingRef = true;
      this.isLoading = true;
      this.error = null;
      this.nextStartIndex = 0;
      this.hasMoreResults = false;
      this.notifyListeners();

      logger.info("Loading library (first page)...", {
        service: "LibraryManager",
        forced: force,
        pageSize: this.PAGE_SIZE,
      });

      // Fetch first page
      const { items, total } = await fetchLibraryVideos({
        limit: this.PAGE_SIZE,
        startIndex: 0,
      });

      this.videos = items;
      this.totalRecordCount = total;
      this.nextStartIndex = items.length;
      this.hasMoreResults = total !== undefined && items.length < total;
      this.lastFetchTime = now;

      // Load library name (force reload if this is a forced refresh)
      await this.loadLibraryName(force);

      this.isLoading = false;
      this.notifyListeners();

      logger.info("Successfully loaded library (first page)", {
        service: "LibraryManager",
        videoCount: items.length,
        totalCount: total,
        hasMore: this.hasMoreResults,
      });
    } catch (err) {
      this.error = getLoadErrorMessage(err);
      this.isLoading = false;
      this.notifyListeners();

      logger.error("Error loading library", err, {
        service: "LibraryManager",
      });
      if (isConnectivityError(err)) {
        void attemptConnectionRecovery();
      }
    } finally {
      this.isLoadingRef = false;
    }
  }

  /**
   * Load next page of library data (pagination)
   */
  async loadMore(): Promise<void> {
    // Guard conditions
    if (this.isLoadingMore || this.isLoading || !this.hasMoreResults) {
      logger.debug("Skipping loadMore", {
        service: "LibraryManager",
        isLoadingMore: this.isLoadingMore,
        isLoading: this.isLoading,
        hasMoreResults: this.hasMoreResults,
      });
      return;
    }

    try {
      this.isLoadingMore = true;
      this.error = null;
      this.notifyListeners();

      logger.info("Loading more library items...", {
        service: "LibraryManager",
        startIndex: this.nextStartIndex,
        currentCount: this.videos.length,
      });

      // Fetch next page
      const { items, total } = await fetchLibraryVideos({
        limit: this.PAGE_SIZE,
        startIndex: this.nextStartIndex,
      });

      // Append new items
      this.videos = [...this.videos, ...items];
      this.totalRecordCount = total;
      this.nextStartIndex = this.nextStartIndex + items.length;
      this.hasMoreResults = total !== undefined && this.videos.length < total;

      this.isLoadingMore = false;
      this.notifyListeners();

      logger.info("Successfully loaded more library items", {
        service: "LibraryManager",
        newItems: items.length,
        totalLoaded: this.videos.length,
        totalCount: total,
        hasMore: this.hasMoreResults,
      });
    } catch (err) {
      this.error = getLoadErrorMessage(err);
      this.isLoadingMore = false;
      // Don't clear videos on pagination error
      this.notifyListeners();

      logger.error("Error loading more library items", err, {
        service: "LibraryManager",
      });
    }
  }

  /**
   * Force refresh library (bypass cache, reload from start)
   */
  async refreshLibrary(): Promise<void> {
    logger.info("Forcing library refresh", { service: "LibraryManager" });
    this.clearCache();
    await this.loadLibrary(true);
  }

  /**
   * Clear cache and reset state
   */
  clearCache(): void {
    this.isLoadingRef = false;
    this.videos = [];
    this.nextStartIndex = 0;
    this.hasMoreResults = false;
    this.totalRecordCount = undefined;
    this.lastFetchTime = 0;
    this.error = null;
    this.libraryNameLoaded = false;
    this.libraryName = "JELLYFIN";
    this.notifyListeners();

    logger.info("Cache cleared", { service: "LibraryManager" });
  }

  /**
   * Get cache age in seconds
   */
  getCacheAge(): number {
    if (this.lastFetchTime === 0) return 0;
    return Math.round((Date.now() - this.lastFetchTime) / 1000);
  }
}

// Export singleton instance
export const libraryManager = LibraryManager.getInstance();
