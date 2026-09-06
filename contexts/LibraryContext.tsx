import React, { createContext, useContext, useState, ReactNode, useMemo, useCallback, useEffect, useRef } from "react";
import { libraryManager } from "@/services/libraryManager";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useAppStateRefresh } from "@/hooks/useAppStateRefresh";

interface LibraryContextType {
  videos: JellyfinVideoItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMoreResults: boolean;
  error: string | null;
  libraryName: string;
  refreshLibrary: () => Promise<void>;
  loadLibrary: (force?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

export function LibraryProvider({ children }: { children: ReactNode }) {
  // Get initial state from singleton
  const initialState = libraryManager.getState();

  const [videos, setVideos] = useState<JellyfinVideoItem[]>(initialState.videos);
  const [isLoading, setIsLoading] = useState(initialState.isLoading);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [error, setError] = useState<string | null>(initialState.error);
  const [libraryName, setLibraryName] = useState<string>(initialState.libraryName);

  // Use ref for isFirstCall to handle both sync and async subscription callbacks
  const isFirstCallRef = useRef(true);

  // Subscribe to singleton state changes
  useEffect(() => {
    // Reset on mount in case of strict mode re-runs
    isFirstCallRef.current = true;

    const unsubscribe = libraryManager.subscribe((state) => {
      // Skip first call since we already initialized from getState()
      if (isFirstCallRef.current) {
        isFirstCallRef.current = false;
        return;
      }

      setVideos(state.videos);
      setIsLoading(state.isLoading);
      setIsLoadingMore(state.isLoadingMore);
      setHasMoreResults(state.hasMoreResults);
      setError(state.error);
      setLibraryName(state.libraryName);
    });

    // Auto-load library on mount
    libraryManager.loadLibrary();

    return unsubscribe;
  }, []);

  // Refresh library when app comes to foreground
  const handleForegroundRefresh = useCallback(() => {
    libraryManager.refreshLibrary();
  }, []);
  useAppStateRefresh(handleForegroundRefresh, "LibraryContext");

  // Stable function references (no dependencies needed)
  const loadLibrary = useCallback(async (force = false) => {
    await libraryManager.loadLibrary(force);
  }, []);

  const refreshLibrary = useCallback(async () => {
    logger.debug("refreshLibrary called", { context: "LibraryContext" });
    await libraryManager.refreshLibrary();
  }, []);

  const loadMore = useCallback(async () => {
    logger.debug("loadMore called", { context: "LibraryContext" });
    await libraryManager.loadMore();
  }, []);

  // Only memoize stable function references - the state values will change naturally
  // This prevents unnecessary object recreation while still allowing state updates
  const value = useMemo(
    () => ({
      videos,
      isLoading,
      isLoadingMore,
      hasMoreResults,
      error,
      libraryName,
      refreshLibrary,
      loadLibrary,
      loadMore,
    }),
    // Note: State values are intentionally included to trigger re-renders when they change
    // The useCallback wrappers on functions make them stable, so this is optimized
    [videos, isLoading, isLoadingMore, hasMoreResults, error, libraryName, refreshLibrary, loadLibrary, loadMore],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (context === undefined) {
    throw new Error("useLibrary must be used within a LibraryProvider");
  }
  return context;
}
