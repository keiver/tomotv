import { clearLibraryView, getLibraryView, loadLibraryView, setLibraryView, subscribeLibraryViews } from "@/services/libraryViews";
import { LibraryFilters } from "@/types/jellyfin";
import React, { createContext, ReactNode, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

interface LibraryFiltersContextType {
  /** The saved sort and filters for a library, or EMPTY_FILTERS when none set. */
  getFilters: (folderId: string) => LibraryFilters;
  setFilters: (folderId: string, next: LibraryFilters) => void;
  clearFilters: (folderId: string) => void;
}

const LibraryFiltersContext = createContext<LibraryFiltersContextType | undefined>(undefined);

let version = 0;
const subscribe = (listener: () => void) =>
  subscribeLibraryViews(() => {
    version += 1;
    listener();
  });
const snapshot = () => version;

/**
 * Per-library sort and filter selections, keyed by library id and kept by services/libraryViews
 * (the device's copy at once, the account's display preferences on the server behind it). Lives at
 * the app root so the folder route and the Sort & Filter route share one state.
 */
export function LibraryFiltersProvider({ children }: { children: ReactNode }) {
  const seen = useSyncExternalStore(subscribe, snapshot, snapshot);

  // The first read of a library starts its server read; a changed server copy re-renders through the store.
  const getFilters = useCallback(
    (folderId: string) => {
      void loadLibraryView(folderId);
      return getLibraryView(folderId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seen],
  );
  const setFilters = useCallback((folderId: string, next: LibraryFilters) => setLibraryView(folderId, next), []);
  const clearFilters = useCallback((folderId: string) => clearLibraryView(folderId), []);

  const value = useMemo(() => ({ getFilters, setFilters, clearFilters }), [getFilters, setFilters, clearFilters]);

  return <LibraryFiltersContext.Provider value={value}>{children}</LibraryFiltersContext.Provider>;
}

export function useLibraryFilters() {
  const context = useContext(LibraryFiltersContext);
  if (context === undefined) {
    throw new Error("useLibraryFilters must be used within a LibraryFiltersProvider");
  }
  return context;
}
