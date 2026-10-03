import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { GROUP_CELL_HEIGHT, GuideGroupCell, HUD_CELL_BACKGROUND } from "@/components/live-tv/guide-group-cell";
import { GuideGroupPlaceholder } from "@/components/live-tv/guide-group-placeholder";
import { useChannelFilterChoices } from "@/hooks/useChannelFilterChoices";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { updateLiveTvPreferences, type ChannelFilter } from "@/services/liveTvPreferences";
import React, { useCallback } from "react";
import { findNodeHandle, Platform, ScrollView, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;
/** The band's full height. */
export const HUD_BAR_HEIGHT = GROUP_CELL_HEIGHT + 1;

/** Contact, key and ambient layers cast onto the rows; negative spread keeps them off the sides. */
const BAND_SHADOW = IS_TV
  ? "0 2px 2px -1px rgba(0, 0, 0, 0.45), 0 6px 10px -4px rgba(0, 0, 0, 0.4), 0 14px 24px -10px rgba(0, 0, 0, 0.35)"
  : "0 1px 1px -0.5px rgba(0, 0, 0, 0.45), 0 3px 6px -2px rgba(0, 0, 0, 0.4), 0 8px 14px -6px rgba(0, 0, 0, 0.35)";

interface GuideHudProps {
  /** The band's leading slot: TV's corner actions over the channel column, phone's guide refresh cell. */
  cornerWidth?: number;
  cornerActions?: React.ReactNode;
  /** TV: the picked group cell's native node, where the guide's top row sends Up. */
  onSelectedHandle?: (handle: number | undefined) => void;
}

/**
 * The guide's HUD band under the time ruler: the corner's round actions over the channel column
 * and the channel groups as grid cells beside them.
 */
export function GuideHud({ cornerWidth, cornerActions, onSelectedHandle }: GuideHudProps) {
  const choices = useChannelFilterChoices();
  const { filter } = useLiveTvPreferences();
  const select = useCallback((next: ChannelFilter) => updateLiveTvPreferences({ filter: next }), []);
  const selectedRef = useCallback(
    (node: View | null) => {
      if (!IS_TV || !onSelectedHandle) return;
      onSelectedHandle(node ? (findNodeHandle(node) ?? undefined) : undefined);
    },
    [onSelectedHandle],
  );

  if (choices.length <= 1 && !cornerActions) return null;
  return (
    <View style={styles.band}>
      {cornerActions ? <View style={[styles.cornerBox, styles.leadingEdge, { width: cornerWidth }]}>{cornerActions}</View> : null}
      <View style={[styles.cellsHost, !cornerActions && styles.leadingEdge]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cells} contentContainerStyle={styles.cellsContent}>
          {choices.map((choice) => {
            const selected = choice.filter === filter;
            return <GuideGroupCell key={choice.filter} ref={selected ? selectedRef : undefined} label={choice.label} selected={selected} onPress={() => select(choice.filter)} />;
          })}
          <GuideGroupPlaceholder />
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: "row",
    alignItems: "center",
    height: HUD_BAR_HEIGHT,
    // The extra point is the band's own grid line, below every cell so no wash covers it.
    borderBottomWidth: 1,
    borderBottomColor: GRID_LINE,
    // Above the rows mounted after it, or they paint over the shadow.
    zIndex: 1,
    boxShadow: BAND_SHADOW,
  },
  // Grows to the viewport so the placeholder can take whatever width the groups leave.
  cellsContent: {
    flexGrow: 1,
    alignItems: "center",
  },
  // The band's left grid line, on whichever slot opens it; inside the width, so the corner stays on the column.
  leadingEdge: {
    borderLeftWidth: 1,
    borderLeftColor: GRID_LINE,
  },
  cornerBox: {
    height: GROUP_CELL_HEIGHT,
    justifyContent: "center",
  },
  // Wears the tiles' floor so the band reads full even past the last group.
  cellsHost: {
    flex: 1,
    alignSelf: "stretch",
    backgroundColor: HUD_CELL_BACKGROUND,
  },
  cells: {
    flex: 1,
    flexGrow: 1,
  },
});
