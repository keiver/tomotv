import { EMPTY_FILTERS, LibraryFilters } from "@/types/jellyfin";
import React, { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";

interface LibraryFiltersContextType {
  /** Filters for a library, or EMPTY_FILTERS when none set. */
  getFilters: (folderId: string) => LibraryFilters;
  setFilters: (folderId: string, next: LibraryFilters) => void;
  clearFilters: (folderId: string) => void;
}

const LibraryFiltersContext = createContext<LibraryFiltersContextType | undefined>(undefined);

/**
 * Per-library filter selections, keyed by folder id. Lives in the (library) stack layout so
 * the folder route and the filters route share state. Session-only, nothing persisted.
 */
export function LibraryFiltersProvider({ children }: { children: ReactNode }) {
  const [filtersByFolder, setFiltersByFolder] = useState<Map<string, LibraryFilters>>(new Map());

  const getFilters = useCallback((folderId: string) => filtersByFolder.get(folderId) ?? EMPTY_FILTERS, [filtersByFolder]);

  const setFilters = useCallback((folderId: string, next: LibraryFilters) => {
    setFiltersByFolder((prev) => {
      const map = new Map(prev);
      map.set(folderId, next);
      return map;
    });
  }, []);

  const clearFilters = useCallback((folderId: string) => {
    setFiltersByFolder((prev) => {
      if (!prev.has(folderId)) return prev;
      const map = new Map(prev);
      map.delete(folderId);
      return map;
    });
  }, []);

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
