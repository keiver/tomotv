import { FilterChip } from "@/components/filter-chip";
import { useChannelFilterChoices } from "@/hooks/useChannelFilterChoices";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { updateLiveTvPreferences, type ChannelFilter } from "@/services/liveTvPreferences";
import React, { useCallback } from "react";
import { findNodeHandle, Platform, ScrollView, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;

interface GuideGroupStripProps {
  edgePadding: number;
  /** TV: the picked chip's native node, where the guide's top row sends Up. */
  onSelectedHandle?: (handle: number | undefined) => void;
}

/** The channel filters as one row of chips above the guide, in layout flow: an overlay would occlude TV focus. */
export function GuideGroupStrip({ edgePadding, onSelectedHandle }: GuideGroupStripProps) {
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

  if (choices.length <= 1) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, { paddingHorizontal: edgePadding }]} style={styles.strip}>
      {choices.map((choice) => {
        const selected = choice.filter === filter;
        return <FilterChip key={choice.filter} ref={selected ? selectedRef : undefined} label={choice.label} selected={selected} onToggle={() => select(choice.filter)} />;
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexGrow: 0,
  },
  row: {
    gap: IS_TV ? 16 : 8,
    paddingBottom: IS_TV ? 24 : 10,
  },
});
