# State Management Architecture

**Last Updated:** June 30, 2026

## Quick Reference

**Category:** Implementation
**Keywords:** state, manager, context, singleton, pub-sub, caching, library, navigation

TomoTV uses a Singleton Manager + Context wrapper pattern for global state with 5-minute TTL caching and pub/sub reactivity.

## Related Documentation

- [`CLAUDE-api-reference.md`](./CLAUDE-api-reference.md) - API integration layer
- [`CLAUDE-patterns.md`](./CLAUDE-patterns.md) - State usage patterns

---

TomoTV uses a **Singleton Manager + Context wrapper** pattern for global state.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│ React Components                                    │
│ (use hooks: useLibrary, useFolderContents)          │
│                    ↓                                 │
├─────────────────────────────────────────────────────┤
│ Context Providers (React Layer)                     │
│ - LibraryContext                                    │
│ - LoadingContext                                    │
│                    ↓ subscribe to managers          │
├─────────────────────────────────────────────────────┤
│ Singleton Managers (State Layer)                    │
│ - LibraryManager.getInstance()                      │
│                    ↓ pub/sub pattern                │
│ Folder browsing: useFolderContents() hook +         │
│   services/folderContentsCache.ts (no singleton;    │
│   the expo-router Stack owns the nav stack)         │
├─────────────────────────────────────────────────────┤
│ API Layer                                           │
│ - jellyfinApi.ts (fetch functions)                  │
│                    ↓ HTTP requests                  │
├─────────────────────────────────────────────────────┤
│ Jellyfin Server                                     │
└─────────────────────────────────────────────────────┘
```

## Why This Pattern

- **Singleton Managers:** State persists across component re-mounts (navigate away and back)
- **React Context:** Provides reactivity and hooks API for components
- **Pub/Sub:** Components re-render only when subscribed state changes
- **Cache Management:** 5-minute TTL handled in managers, not scattered across components
- **Type Safety:** Full TypeScript interfaces throughout
- **Performance:** Prevents duplicate API calls via loading state guards

**Alternative Considered:** Redux/Zustand (rejected due to overhead for this app's scope)

## Singleton Managers

Location: `services/`

### LibraryManager

**Public API:**

- `getInstance()` - Get singleton instance
- `getState()` - Get current state snapshot
  ```typescript
  {
    videos: JellyfinItem[];
    isLoading: boolean;
    isLoadingMore: boolean;
    hasMoreResults: boolean;
    error: string | null;
    libraryName: string;
  }
  ```
- `subscribe(callback)` - Subscribe to state changes (returns unsubscribe function)
- `refreshLibrary()` - Force refresh from API
- `loadMore()` - Load next page
- `clearCache()` - Clear cached videos and state

**Cache Strategy:**

- 5-minute TTL on library data
- Automatic refresh on cache expiration
- Clears on credential changes

### Folder browsing — `useFolderContents` (no singleton)

Folder drill-down is **real expo-router navigation**, not a singleton. Each folder level is a pushed
route under `app/(tabs)/(library)/` (`index.tsx` = libraries root, `[folderId].tsx` = a folder), so
the router's back stack is the single source of truth and the Apple TV Menu button pops it natively.

- **`hooks/useFolderContents.ts`** — `useFolderContents(folderId | null, type?)` loads + paginates one
  folder for one screen. Returns `{ items, isLoading, isLoadingMore, hasMoreResults, error, loadMore,
refresh }`. `folderId === null` → libraries root (`fetchUserViews`); otherwise
  `fetchFolderContents` / `fetchPlaylistContents` (playlists detected via the route's `type` param).
- **`services/folderContentsCache.ts`** — module-level first-page cache keyed by folder id ("root"
  for the libraries view), 5-minute TTL. `clearFolderContentsCache()` is called by the auth flows in
  `jellyfinApi.ts` (connect / server-switch / sign-out) to drop stale content.

## Context Wrappers

Location: `contexts/`

- `LibraryContext` - React wrapper for `LibraryManager`, provides `useLibrary()` hook
- `LoadingContext` - Global loading state (modal spinner)

## Other State

- **SecureStore:** Persistent storage for credentials (device Keychain / Android Keystore)
- **Component State:** React hooks (`useState`, `useReducer`) for local state
- **Configuration:** Three-tier fallback (user settings → dev credentials → defaults)

## Usage Examples

### Using Library State

```typescript
import { useLibrary } from "@/contexts/LibraryContext";

const { videos, isLoading, hasMoreResults, loadMore, refreshLibrary } = useLibrary();
```

### Using Folder Contents

```typescript
import { useFolderContents } from "@/hooks/useFolderContents";

// libraries root screen
const { items, isLoading, loadMore } = useFolderContents(null);
// a folder route ([folderId].tsx) — folderId + type come from route params
const { items, isLoading, loadMore } = useFolderContents(folderId, type);
```

To drill in, `router.push({ pathname: "/[folderId]", params: { folderId, name, type, crumbs } })`;
**back is native** — the Menu/back button pops the Stack (no JS handler). Features:

- Per-folder caching with 5-minute TTL (`services/folderContentsCache.ts`)
- Pagination via `loadMore()`
- Header path / breadcrumb derives from the pushed route's `crumbs` param (`components/library-header.tsx`)
- **Playlist support:** Playlists use a different API endpoint (`/Playlists/{id}/Items`), detected via
  the route's `type` param

### Using Global Loading

```typescript
import { useLoading } from "@/contexts/LoadingContext";

const { showGlobalLoader, hideGlobalLoader } = useLoading();

showGlobalLoader();
// ... async operation
hideGlobalLoader();
```
