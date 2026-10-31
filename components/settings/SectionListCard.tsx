import { hasMoreBelow } from "@/components/settings/MoreBelowHint";
import { settingsStyles } from "@/components/settings/styles";
import React, { useCallback, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

const IS_TV = Platform.isTV;

export type RowGroup<T> = { title?: string; data: T[] };

/** What the card hands a row: card-edge rounding, TV focus pinning and the more-below hint. */
export type RowPlace = {
  isFirst: boolean;
  isLast: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  moreBelow?: boolean;
};

// The subgroup header's line is pinned so the card's whole-row height cap is arithmetic.
const HEADER_LINE_HEIGHT = IS_TV ? 36 : 20;
/** Height of one subgroup header inside the card: its paddings plus the pinned line. */
export const CARD_HEADER_HEIGHT = settingsStyles.sectionHeader.paddingTop + settingsStyles.sectionHeader.paddingBottom + HEADER_LINE_HEIGHT;

interface SectionListCardProps<T> {
  groups: readonly RowGroup<T>[];
  keyExtractor: (item: T) => string;
  renderRow: (item: T, place: RowPlace) => React.ReactElement;
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  listStyle?: StyleProp<ViewStyle>;
}

/**
 * One grouped-list card whose rows scroll inside it, with a header per group.
 * The screen renders its own rows and spreads the RowPlace it is handed.
 * A plain ScrollView, like the licenses and quality cards: every row mounted,
 * so tvOS focus can walk the whole list and the height cap is honoured.
 */
export function SectionListCard<T>({ groups, keyExtractor, renderRow, footer, style, listStyle }: SectionListCardProps<T>) {
  const listRef = useRef<ScrollView>(null);

  // Scroll metrics and row bounds live in refs; state holds only the booleans and the
  // hint's row, so a focus step or scroll frame that changes nothing re-renders nothing.
  const metrics = useRef({ offset: 0, viewport: 0, content: 0 });
  const rowBounds = useRef(new Map<string, { y: number; height: number }>());
  const focusedCount = useRef(0);
  const pendingLastVisible = useRef<string | null>(null);
  const [belowRemains, setBelowRemains] = useState(false);
  const [focusedInside, setFocusedInside] = useState(false);
  const [lastVisibleKey, setLastVisibleKey] = useState<string | null>(null);

  const measure = useCallback(() => {
    const { offset, viewport, content } = metrics.current;
    setBelowRemains(hasMoreBelow(offset, viewport > 0 ? viewport : undefined, content));
    const bottom = offset + viewport;
    let bestKey: string | null = null;
    let bestY = -1;
    for (const [key, bounds] of rowBounds.current) {
      if (bounds.y + bounds.height <= bottom + 1 && bounds.y > bestY) {
        bestY = bounds.y;
        bestKey = key;
      }
    }
    pendingLastVisible.current = bestKey;
    // The hint only shows while focus is outside, so a focus-driven scroll parks the row here.
    if (focusedCount.current === 0) setLastVisibleKey(bestKey);
  }, []);

  // The chevron hints at rows past the window only while focus is elsewhere.
  // Counted, so a row's focus landing before its neighbour's blur cannot clear it.
  const enter = useCallback(() => {
    focusedCount.current += 1;
    setFocusedInside(true);
  }, []);
  const leave = useCallback(() => {
    focusedCount.current = Math.max(0, focusedCount.current - 1);
    if (focusedCount.current === 0) {
      setFocusedInside(false);
      setLastVisibleKey(pendingLastVisible.current);
    }
  }, []);
  // Pin the ends so tvOS can move focus out of the nested list.
  const pinToTop = useCallback(() => {
    enter();
    listRef.current?.scrollTo({ y: 0, animated: false });
  }, [enter]);
  const pinToBottom = useCallback(() => {
    enter();
    listRef.current?.scrollToEnd({ animated: false });
  }, [enter]);

  const rows = groups.flatMap((group) => group.data);
  const topKey = rows.length > 0 ? keyExtractor(rows[0]) : null;
  const endKey = rows.length > 0 ? keyExtractor(rows[rows.length - 1]) : null;
  // A row rounds a card corner only when it sits on that edge: no header above, no footer below.
  const firstGroup = groups.find((group) => group.data.length > 0);
  const roundTop = firstGroup != null && firstGroup.title == null;
  const roundBottom = footer == null;

  const moreBelow = !focusedInside && belowRemains;

  return (
    <View style={[settingsStyles.section, style]}>
      <ScrollView
        ref={listRef}
        style={[styles.list, listStyle]}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        focusable={false}
        scrollEventThrottle={16}
        onScroll={
          IS_TV
            ? ({ nativeEvent }) => {
                metrics.current.offset = nativeEvent.contentOffset.y;
                measure();
              }
            : undefined
        }
        onLayout={
          IS_TV
            ? (event) => {
                metrics.current.viewport = event.nativeEvent.layout.height;
                measure();
              }
            : undefined
        }
        onContentSizeChange={
          IS_TV
            ? (_, height) => {
                metrics.current.content = height;
                measure();
              }
            : undefined
        }>
        {groups.map((group, groupIndex) => (
          <React.Fragment key={group.title ?? `group-${groupIndex}`}>
            {group.title ? (
              <View style={settingsStyles.sectionHeader}>
                <Text style={[settingsStyles.sectionHeaderText, styles.headerText]} accessibilityRole="header">
                  {group.title}
                </Text>
              </View>
            ) : null}
            {group.data.map((item) => {
              const key = keyExtractor(item);
              const place: RowPlace = { isFirst: roundTop && key === topKey, isLast: roundBottom && key === endKey };
              if (!IS_TV) return <React.Fragment key={key}>{renderRow(item, place)}</React.Fragment>;
              place.onFocus = key === topKey ? pinToTop : key === endKey ? pinToBottom : enter;
              place.onBlur = leave;
              if (key === lastVisibleKey) place.moreBelow = moreBelow;
              return (
                <View key={key} collapsable={false} onLayout={(event) => rowBounds.current.set(key, { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height })}>
                  {renderRow(item, place)}
                </View>
              );
            })}
          </React.Fragment>
        ))}
      </ScrollView>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  // Sized by its rows until the cap clips it, which is when it scrolls.
  list: {
    flexGrow: 0,
    flexShrink: 1,
  },
  headerText: {
    lineHeight: HEADER_LINE_HEIGHT,
  },
});
