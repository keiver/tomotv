# CLAUDE-components.md

**Last Updated:** January 24, 2026

## Quick Reference

**Category:** Implementation
**Keywords:** components, UI, VideoGridItem, FolderGridItem, performance, React.memo, FlatList

All reusable UI components in TomoTV with optimization patterns, props, and performance considerations.

## Related Documentation

- [`CLAUDE-testing.md`](./CLAUDE-testing.md) - Component tests
- [`CLAUDE-patterns.md`](./CLAUDE-patterns.md) - Component patterns
- [`CLAUDE-app-performance.md`](./CLAUDE-app-performance.md) - Performance optimizations

---

This document describes all reusable UI components in the TomoTV app.

## Overview

TomoTV uses a small set of highly optimized components designed for TV platforms with focus navigation.

---

## Grid Components

### VideoGridItem

**File:** `components/video-grid-item.tsx`

**Purpose:** Display video card with poster, title, and metadata overlay.

**Props:**

```typescript
{
  video: JellyfinVideoItem;
  onPress: (video: JellyfinVideoItem) => void;
  index: number;
  onItemFocus?: () => void;
  onItemBlur?: () => void;
  hasTVPreferredFocus?: boolean;
  nextFocusUp?: number;
}
```

**Features:**

- React.memo with custom comparison (prevents unnecessary re-renders)
- Lazy metadata computation (only when focused)
- Platform-specific sizing (TV: larger, phone: smaller)
- High-priority image caching for first 10 items
- BlurView backdrop only when focused
- No scale animations (instant border feedback only) - **PERFORMANCE:** Eliminates UI jumpiness during rapid navigation and app startup by avoiding GPU overhead for 60+ simultaneous animations

**Optimizations:**

- Custom `getItemLayout` for FlatList performance
- Computed dimensions based on grid columns and screen width
- Memoized focus handlers

**Usage:**

```typescript
<VideoGridItem
  video={item}
  onPress={handleSelectVideo}
  index={index}
  hasTVPreferredFocus={index === 0}
/>
```

---

### FolderGridItem

**File:** `components/folder-grid-item.tsx`

**Purpose:** Display folder, playlist, or collection card with icon.

**Props:**

```typescript
{
  folder: JellyfinItem;
  onPress: (folder: JellyfinItem) => void;
  index: number;
  hasTVPreferredFocus?: boolean;
}
```

**Features:**

- Golden folder icon from Ionicons (`folder`)
- Thumbnail fallback for folders with poster images
- Folder badge indicator always visible
- Same optimization strategy as VideoGridItem

**Icon Handling:**
Uses Ionicons from @expo/vector-icons:

```typescript
<Ionicons name="folder" size={IS_TV ? 80 : 50} color="#FFC312" />
```

---

> Removed June 2026: `BackGridItem` (in-grid back card) and the rotated `FolderBreadcrumb`. Folder
> drill-down is now real expo-router routes; the Apple TV Menu/back button pops the Stack natively,
> and the header path lives in `LibraryHeader` (see below).

---

## Layout Components

### LibraryGrid

**File:** `components/library-grid.tsx`

**Purpose:** Presentational grid for both the libraries root and folder screens. Pure UI — it
receives data + callbacks and renders the grid, header, empty/error states, and (root only) the
Continue Watching shelf as a footer below the libraries. Navigation + data loading live in the route
screens (`app/(tabs)/(library)/index.tsx`, `[folderId].tsx`).

**Key props:** `items`, `isLoading`, `isLoadingMore`, `hasMoreResults`, `error`, `onItemPress`,
`onLoadMore`, `variant: "root" | "folder"`, `crumbs?` (path for the header), `onBack?` (touch back
row). Must render inside a `PosterBackdropProvider`.

### LibraryHeader

**File:** `components/library-header.tsx`

**Purpose:** Folder-context header. TV shows a non-focusable path (back is the remote's Menu button →
native Stack pop); touch shows a tappable "‹ CurrentFolder" row. Driven by the route's `crumbs` param
(`FolderStackEntry[]`: `{ id, name, type, parentId? }`).

---

## Utility Components

### FocusableButton

**File:** `components/FocusableButton.tsx`

**Purpose:** Accessible button component with TV remote focus support.

**Props:**

```typescript
{
  onPress: () => void;
  children: React.ReactNode;
  style?: ViewStyle;
  isTVSelectable?: boolean;
}
```

**Features:**

- Proper focus handling on TV platforms
- Accessible to screen readers
- Customizable styling
- Used in Settings screen for action buttons

**Focus States:**

- Normal: Default appearance
- Focused: Border highlight (golden accent)
- Pressed: Scale animation feedback

---

## Global Components

### GlobalLoader

**File:** Rendered by `LoadingContext`

**Purpose:** Full-screen loading overlay with spinner.

**Usage:**

```typescript
const { showGlobalLoader, hideGlobalLoader } = useLoading();

showGlobalLoader();
// ... async operation
hideGlobalLoader();
```

**Features:**

- Modal overlay (blocks interaction)
- Semi-transparent black background
- Centered ActivityIndicator
- Managed via React Context (single source of truth)

---

## Performance Considerations

### Grid Item Optimization Strategy

All grid items (Video, Folder, Back) follow these patterns:

1. **React.memo** with custom comparison to prevent re-renders on parent updates
2. **No Scale Animations** - Border-only focus feedback for instant response
3. **Lazy Metadata** - Duration/filesize computed only when focused
4. **Image Priority** - First 10 items use high-priority caching
5. **Platform Sizing** - Dynamic dimensions based on screen size and column count

### FlatList Configuration

When using grid items in FlatList:

```typescript
<FlatList
  data={items}
  numColumns={gridColumns}
  getItemLayout={(data, index) => ({
    length: itemHeight,
    offset: itemHeight * Math.floor(index / gridColumns),
    index,
  })}
  windowSize={11}
  removeClippedSubviews
  updateCellsBatchingPeriod={50}
/>
```

---

## Design System / Color Palette

| Color          | Hex       | Usage                                    |
| -------------- | --------- | ---------------------------------------- |
| Background     | `#1C1C1E` | All screen backgrounds                   |
| Card/Section   | `#2C2C2E` | Settings sections, elevated surfaces     |
| Card Focused   | `#3A3A3C` | Focused card background                  |
| Primary/Gold   | `#FFC312` | Icons, focus borders, accents            |
| Success/Green  | `#34C759` | URLs, Jellyfin highlight, success states |
| Text Primary   | `#FFFFFF` | Headings, important text                 |
| Text Secondary | `#8E8E93` | Subtitles, labels                        |
| Text Tertiary  | `#636366` | Captions, hints                          |
