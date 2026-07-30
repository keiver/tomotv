import { FiltersGhostTitle } from "@/components/filters-ghost-title";
import { FocusableButton } from "@/components/FocusableButton";
import { FolderStackEntry } from "@/types/jellyfin";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface LibraryHeaderProps {
  /** Current folder navigation stack. Empty = library root (header renders nothing). */
  stack: FolderStackEntry[];
  /** Go up one folder level. Wired to the touch back row; on TV the Menu/back key handles it. */
  onBack: () => void;
  /** Opens the Filters panel. Renders the breadcrumb's suffix action only when provided. */
  onOpenFilters?: () => void;
  /** Number of active filter selections, shown on the Filters button. */
  activeFilterCount?: number;
  /** Give the Filters button TV preferred focus (empty grids: it is the screen's focus anchor). */
  filtersButtonHasPreferredFocus?: boolean;
  /** Reports the Filters button's native node so the grid can target it with nextFocusUp. */
  onFiltersButtonRef?: (node: View | null) => void;
}

/**
 * Folder context header for the Library tab. Replaces the old in-grid "Back card" and the
 * rotated left-edge breadcrumb.
 *
 * - TV (tvOS/Android TV): a non-focusable path so the user knows where they are. There is NO
 *   on-screen back control — going up is the remote's Menu/back button, which pops the nested
 *   navigation Stack natively.
 * - Touch (iOS/Android phone): a tappable "‹ CurrentFolder" row, since touch has no back key.
 *
 * On TV this bar is a plain row rendered as a pinned sibling ABOVE the folder grid (not a list
 * header), so it never scrolls off-screen. The grid routes Up from its top row straight to the
 * right-aligned Filters button via nextFocusUp (the button reports its native node through
 * onFiltersButtonRef) — no focus guide/destinations, which are unreliable on Fabric/tvOS.
 */
function LibraryHeaderComponent({ stack, onBack, onOpenFilters, activeFilterCount = 0, filtersButtonHasPreferredFocus = false, onFiltersButtonRef }: LibraryHeaderProps) {
  const filtersButtonRef = useCallback(
    (node: View | null) => {
      onFiltersButtonRef?.(node);
    },
    [onFiltersButtonRef],
  );

  if (stack.length === 0) {
    return null;
  }

  const current = stack[stack.length - 1];

  const filtersButton = onOpenFilters ? (
    <FocusableButton
      ref={filtersButtonRef}
      title={activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filters"}
      variant="secondary"
      hasTVPreferredFocus={filtersButtonHasPreferredFocus}
      onPress={onOpenFilters}
      icon={<Ionicons name="options-outline" size={IS_TV ? 24 : 18} color="#FFC312" />}
      style={styles.filtersButton}
      textStyle={styles.filtersButtonText}
    />
  ) : null;

  if (IS_TV) {
    return (
      <View style={styles.tvContainer}>
        {/* Faint oversized library name behind the controls — the header's ambient title. Spills down
            out of the row (top-anchored), clipped at the right edge; never intercepts focus. */}
        <FiltersGhostTitle name={stack[0]?.name ?? ""} variant="header" />
        {filtersButton}
        <View style={styles.tvPath} pointerEvents="none">
          {stack.map((entry, index) => {
            const isLast = index === stack.length - 1;
            return (
              <View key={entry.id} style={styles.pathSegment}>
                <Text style={[styles.tvPathText, isLast && styles.tvPathTextCurrent]} numberOfLines={1}>
                  {entry.name}
                </Text>
                {!isLast && <Ionicons name="chevron-forward" size={22} color="#FFC312" style={styles.pathSeparator} />}
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  // Back + title lead the row; Filters sits at the right edge so the title is
  // the first thing read and the pill stays out of its way.
  return (
    <View style={styles.touchRow}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        accessibilityHint={`Return to ${stack.length > 1 ? stack[stack.length - 2].name : "Libraries"}`}
        style={({ pressed }) => [styles.touchBackRow, pressed && styles.touchBackRowPressed]}>
        <Ionicons name="chevron-back" size={26} color="#FFC312" />
        <Text style={styles.touchBackText} numberOfLines={1}>
          {current.name}
        </Text>
      </Pressable>
      {filtersButton}
    </View>
  );
}

export const LibraryHeader = React.memo(LibraryHeaderComponent);

const styles = StyleSheet.create({
  // --- TV: focusable Filters button, then the non-focusable path ---
  tvContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    marginLeft: 16,
    marginBottom: 4,
    paddingBottom: 14,
  },
  tvPath: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    flexShrink: 1,
  },
  pathSegment: {
    flexDirection: "row",
    alignItems: "center",
  },
  tvPathText: {
    color: "#98989D",
    fontSize: 28,
    fontWeight: "700",
    maxWidth: 360,
  },
  tvPathTextCurrent: {
    color: "#FFFFFF",
  },
  pathSeparator: {
    marginHorizontal: 8,
  },
  // --- Touch: tappable back row, Filters pushed to the right edge ---
  touchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingRight: 16,
  },
  touchBackRow: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    marginLeft: 4,
    paddingVertical: 6,
    paddingRight: 12,
  },
  touchBackRowPressed: {
    opacity: 0.6,
  },
  touchBackText: {
    marginLeft: 2,
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    maxWidth: 280,
  },
  // Compact override of FocusableButton's full-size defaults so it fits the breadcrumb bar.
  // Phone: shallow pill, vertically centered against the back row's arrow and title.
  filtersButton: {
    minWidth: 0,
    minHeight: IS_TV ? 52 : 32,
    paddingVertical: IS_TV ? 8 : 3,
    paddingHorizontal: IS_TV ? 28 : 14,
  },
  filtersButtonText: {
    fontSize: IS_TV ? 22 : 14,
  },
});
