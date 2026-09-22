import { GlassButton } from "@/components/glass-button";
import { COLORS } from "@/constants/colors";
import { FolderStackEntry } from "@/types/jellyfin";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { t } from "@/services/i18n";

interface LibraryHeaderProps {
  /** Current folder navigation stack. Empty = library root (header renders nothing). */
  stack: FolderStackEntry[];
  /** Jumps to the home shelves. Renders the home glass button only when provided. */
  onGoHome?: () => void;
  /** The leading button reads as Back where the route sits one level above its opener. */
  homeAsBack?: boolean;
  /** Opens the Filters panel. Renders the glass Filters capsule only when provided. */
  onOpenFilters?: () => void;
  /** Number of active filter selections, shown on the Filters button. */
  activeFilterCount?: number;
  /** Give the Filters button TV preferred focus (empty grids: it is the screen's focus anchor). */
  filtersButtonHasPreferredFocus?: boolean;
  /** Reports the Filters button's native node so the grid can target it with nextFocusUp. */
  onFiltersButtonRef?: (node: View | null) => void;
  /** TV: the Filters button gained/lost focus (grid focus bookkeeping, see library-grid's recovery). */
  onFiltersFocusChange?: (focused: boolean) => void;
}

/**
 * tvOS folder header: a home glass button, the non-focusable path, then the Filters capsule
 * pushed to the right. Home is for viewers who don't reach for the remote's Menu button — one
 * press exits folder browsing, where a back button would have to be refocused at every level.
 */
function LibraryHeaderComponent({
  stack,
  onGoHome,
  homeAsBack = false,
  onOpenFilters,
  activeFilterCount = 0,
  filtersButtonHasPreferredFocus = false,
  onFiltersButtonRef,
  onFiltersFocusChange,
}: LibraryHeaderProps) {
  const filtersButtonRef = useCallback(
    (node: View | null) => {
      onFiltersButtonRef?.(node);
    },
    [onFiltersButtonRef],
  );
  const handleFiltersFocus = useCallback(() => onFiltersFocusChange?.(true), [onFiltersFocusChange]);
  const handleFiltersBlur = useCallback(() => onFiltersFocusChange?.(false), [onFiltersFocusChange]);

  if (stack.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {onGoHome ? (
        <GlassButton
          onPress={onGoHome}
          accessibilityLabel={homeAsBack ? t("common.back") : t("tab.home")}
          icon={<Ionicons name={homeAsBack ? "chevron-back" : "home"} size={24} color={COLORS.ACCENT} />}
        />
      ) : null}
      <View style={styles.path} pointerEvents="none">
        {stack.map((entry, index) => {
          const isLast = index === stack.length - 1;
          return (
            <View key={entry.id} style={styles.pathSegment}>
              <Text style={[styles.pathText, isLast && styles.pathTextCurrent]} numberOfLines={1}>
                {entry.name}
              </Text>
              {!isLast && <Ionicons name="chevron-forward" size={22} color={COLORS.TEXT_TERTIARY} style={styles.pathSeparator} />}
            </View>
          );
        })}
      </View>
      {onOpenFilters ? (
        <GlassButton
          ref={filtersButtonRef}
          title={activeFilterCount > 0 ? t("filters.titleCount").replace("{count}", String(activeFilterCount)) : t("filters.title")}
          hasTVPreferredFocus={filtersButtonHasPreferredFocus}
          onPress={onOpenFilters}
          onFocus={handleFiltersFocus}
          onBlur={handleFiltersBlur}
          icon={<Ionicons name="funnel-outline" size={24} color={COLORS.ACCENT} />}
        />
      ) : null}
    </View>
  );
}

export const LibraryHeader = React.memo(LibraryHeaderComponent);

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingBottom: 14,
  },
  // Grows to fill the row so the Filters capsule is pushed to the right edge.
  path: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    flex: 1,
  },
  pathSegment: {
    flexDirection: "row",
    alignItems: "center",
  },
  pathText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 28,
    fontWeight: "700",
    maxWidth: 360,
  },
  pathTextCurrent: {
    color: COLORS.TEXT_PRIMARY,
  },
  pathSeparator: {
    marginHorizontal: 8,
  },
});
