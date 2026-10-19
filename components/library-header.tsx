import { GlassButton } from "@/components/glass-button";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { FolderStackEntry } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import { findNodeHandle, StyleSheet, Text, TVFocusGuideView, View, type LayoutChangeEvent } from "react-native";
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
  /** The trailing capsule where Filters would sit, for a grid with a different action (the channel wall's Settings). */
  action?: HeaderAction;
  /** A capsule to the left of `action` (the wall's favorites filter toggle). */
  secondaryAction?: HeaderAction;
  /** A control leading the bar's right cluster (the wall's Live TV search reveal). */
  trailing?: React.ReactNode;
  /** The trailing control's focusable view, the right cluster's first stop. */
  trailingTarget?: View | null;
  /** Under the path, sends Up from the band below to the nearer of the leading button and the right cluster. */
  upGuides?: boolean;
}

export interface HeaderAction {
  /** Omit for an icon-only capsule, and name it through accessibilityLabel. */
  title?: string;
  icon: keyof typeof Ionicons.glyphMap | React.ReactElement;
  accessibilityLabel?: string;
  onPress: () => void;
}

function actionIcon(icon: HeaderAction["icon"], accent: string) {
  return typeof icon === "string" ? <Ionicons name={icon} size={24} color={accent} /> : icon;
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
  action,
  secondaryAction,
  trailing,
  trailingTarget,
  upGuides = false,
}: LibraryHeaderProps) {
  const [actionNode, setActionNode] = useState<View | null>(null);
  const filtersButtonRef = useCallback(
    (node: View | null) => {
      setActionNode(node);
      onFiltersButtonRef?.(node);
    },
    [onFiltersButtonRef],
  );
  const [leadNode, setLeadNode] = useState<View | null>(null);
  const [secondaryNode, setSecondaryNode] = useState<View | null>(null);
  const [path, setPath] = useState<{ x: number; width: number } | null>(null);
  const handlePathLayout = useCallback((event: LayoutChangeEvent) => setPath({ x: event.nativeEvent.layout.x, width: event.nativeEvent.layout.width }), []);
  const handleFiltersFocus = useCallback(() => onFiltersFocusChange?.(true), [onFiltersFocusChange]);
  const handleFiltersBlur = useCallback(() => onFiltersFocusChange?.(false), [onFiltersFocusChange]);
  const { accent } = useCardPalette();

  if (stack.length === 0) {
    return null;
  }

  // Each half of the path's span leads to the button nearer it; a guide without a destination would trap the press.
  // Keyed by its target: a destination changed on a mounted guide does not hold on Fabric, a fresh guide takes it.
  const leftTarget = leadNode ? findNodeHandle(leadNode) : null;
  const rightNode = trailingTarget ?? secondaryNode ?? actionNode;
  const rightTarget = rightNode ? findNodeHandle(rightNode) : null;
  const guides =
    upGuides && path && path.width > 0 && leftTarget && rightTarget ? (
      <View style={styles.guideRow} testID="library-header-up-guides">
        <View style={{ width: path.x }} />
        <TVFocusGuideView key={`left-${leftTarget}`} style={{ width: path.width / 2 }} destinations={[leftTarget]} />
        <TVFocusGuideView key={`right-${rightTarget}`} style={{ width: path.width / 2 }} destinations={[rightTarget]} />
      </View>
    ) : null;

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        {onGoHome ? (
          <GlassButton
            ref={setLeadNode}
            onPress={onGoHome}
            accessibilityLabel={homeAsBack ? t("common.back") : t("tab.home")}
            icon={<Ionicons name={homeAsBack ? "chevron-back" : "home"} size={24} color={accent} />}
          />
        ) : null}
        <View style={styles.path} pointerEvents="none" onLayout={upGuides ? handlePathLayout : undefined}>
          {stack.map((entry, index) => {
            const isLast = index === stack.length - 1;
            return (
              <View key={entry.id} style={styles.pathSegment}>
                <Text style={[styles.pathText, isLast && styles.pathTextCurrent]} numberOfLines={1}>
                  {cleanLabel(entry.name)}
                </Text>
                {!isLast && <Ionicons name="chevron-forward" size={22} color={COLORS.TEXT_TERTIARY} style={styles.pathSeparator} />}
              </View>
            );
          })}
        </View>
        {trailing ?? null}
        {secondaryAction ? (
          <GlassButton
            ref={setSecondaryNode}
            title={secondaryAction.title}
            accessibilityLabel={secondaryAction.accessibilityLabel}
            onPress={secondaryAction.onPress}
            icon={actionIcon(secondaryAction.icon, accent)}
          />
        ) : null}
        {onOpenFilters ? (
          <GlassButton
            ref={filtersButtonRef}
            title={activeFilterCount > 0 ? t("filters.titleCount").replace("{count}", String(activeFilterCount)) : t("filters.title")}
            hasTVPreferredFocus={filtersButtonHasPreferredFocus}
            onPress={onOpenFilters}
            onFocus={handleFiltersFocus}
            onBlur={handleFiltersBlur}
            icon={<Ionicons name="funnel-outline" size={24} color={accent} />}
          />
        ) : action ? (
          <GlassButton
            ref={filtersButtonRef}
            title={action.title}
            hasTVPreferredFocus={filtersButtonHasPreferredFocus}
            onPress={action.onPress}
            onFocus={handleFiltersFocus}
            onBlur={handleFiltersBlur}
            accessibilityLabel={action.accessibilityLabel}
            icon={actionIcon(action.icon, accent)}
          />
        ) : null}
      </View>
      {guides}
    </View>
  );
}

export const LibraryHeader = React.memo(LibraryHeaderComponent);

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 4,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    paddingBottom: 14,
  },
  // One point tall, between the bar and what sits under it, as the guide's entry guide is.
  guideRow: {
    flexDirection: "row",
    height: 1,
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
