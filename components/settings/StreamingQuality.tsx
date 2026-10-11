import { LinkLadder } from "@/components/settings/LinkLadder";
import { ListRow } from "@/components/settings/ListRow";
import { hasMoreBelow, lastVisibleRow } from "@/components/settings/MoreBelowHint";
import { QualityMark } from "@/components/settings/QualityMark";
import { QUALITY_ROWS, qualityLabel, qualityRowSubtitle } from "@/components/settings/qualityRows";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { IS_PAD, QUALITY_ROW_HEIGHT, QUALITY_SUBTITLE_LINE_HEIGHT, QUALITY_TITLE_LINE_HEIGHT, settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { carriedRungs, ORIGINAL_INDEX } from "@/services/adaptiveQuality";
import { t } from "@/services/i18n";
import { measureIfIdle, rememberedBitrateStatus } from "@/services/jellyfin/bitrateTest";
import { STORAGE_KEYS } from "@/services/jellyfin/constants";
import { logger } from "@/utils/logger";
import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/** The server's output quality cap, with each choice's quality/data tradeoff. */
export function StreamingQuality({ availableHeight }: { availableHeight?: number }) {
  // Default mirrors DEFAULT_QUALITY in jellyfinApi.ts (Original), so the ticked row matches
  // what playback actually uses before a choice is saved.
  const [videoQuality, setVideoQuality] = useState(5);
  const [measuredBps, setMeasuredBps] = useState<number | null>(null);
  const listRef = useRef<ScrollView>(null);
  const [rowHeight, setRowHeight] = useState(QUALITY_ROW_HEIGHT);
  const [headingHeight, setHeadingHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);

  // Reserve the heading and footer before fitting whole rows into the TV's remaining space.
  // Keep at least one row reachable; the page can still scroll at unusually large text sizes.
  const visibleRows = IS_TV ? Math.max(1, Math.min(4, Math.floor(((availableHeight ?? 0) - headingHeight - footerHeight - settingsStyles.section.marginBottom) / rowHeight))) : 3;
  const listHeight = Math.min(QUALITY_ROWS.length, visibleRows) * rowHeight;
  const [scrollY, setScrollY] = useState(0);
  const lastVisible = lastVisibleRow(scrollY, listHeight, rowHeight);
  const moreBelow = hasMoreBelow(scrollY, listHeight, QUALITY_ROWS.length * rowHeight);

  // The chevron hints at rows past the window only while focus is elsewhere.
  // Counted, so a row's focus landing before its neighbour's blur cannot clear it.
  const [focusedRows, setFocusedRows] = useState(0);
  const focusedInside = focusedRows > 0;
  const enter = useCallback(() => setFocusedRows((n) => n + 1), []);
  const leave = useCallback(() => setFocusedRows((n) => Math.max(0, n - 1)), []);
  // Pin the ends so tvOS can move focus out of the nested list.
  const pinListToTop = useCallback(() => {
    enter();
    listRef.current?.scrollTo({ y: 0, animated: false });
  }, [enter]);
  const pinListToBottom = useCallback(() => {
    enter();
    listRef.current?.scrollToEnd({ animated: false });
  }, [enter]);

  // The saved preset, then the link: the remembered reading first, a fresh probe when it is stale.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await SecureStore.getItemAsync(STORAGE_KEYS.VIDEO_QUALITY);
      if (cancelled) return;
      if (saved) setVideoQuality(parseInt(saved, 10));
      const status = await rememberedBitrateStatus();
      if (cancelled) return;
      setMeasuredBps(status?.bps ?? null);
      if (status?.fresh) return;
      const bps = await measureIfIdle();
      if (cancelled) return;
      if (bps != null) setMeasuredBps(bps);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleQualityChange = async (value: number) => {
    try {
      setVideoQuality(value);
      // No confirmation dialog: the tick moves to the row, which is the confirmation.
      await SecureStore.setItemAsync(STORAGE_KEYS.VIDEO_QUALITY, value.toString());
    } catch (error) {
      logger.error("Error saving video quality", error);
      Alert.alert(t("common.error"), t("settings.qualitySaveFailed"));
    }
  };

  const carried = carriedRungs(measuredBps);
  return (
    <>
      <View style={settingsStyles.sectionHeader} onLayout={IS_TV ? (event) => setHeadingHeight(event.nativeEvent.layout.height) : undefined}>
        <Text style={settingsStyles.sectionHeaderText} accessibilityRole="header">
          {t("settings.transcoding.quality")}
        </Text>
      </View>
      <View style={settingsStyles.section}>
        <ScrollView
          ref={listRef}
          style={{ height: listHeight }}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          focusable={false}
          scrollEventThrottle={16}
          onScroll={IS_TV ? ({ nativeEvent }) => setScrollY(nativeEvent.contentOffset.y) : undefined}
          // All presets use the same pinned lines. Measuring includes Dynamic Type scaling.
          onContentSizeChange={(_, height) => {
            if (height > 0) setRowHeight(height / QUALITY_ROWS.length);
          }}>
          {QUALITY_ROWS.map((value, index) => {
            const selected = videoQuality === value;
            const subtitle = qualityRowSubtitle(value);
            return (
              <ListRow
                key={value}
                icon={({ color }) => (value === ORIGINAL_INDEX ? <LinkLadder carried={carried} color={color} /> : <QualityMark value={value} color={color} />)}
                title={qualityLabel(value)}
                subtitle={subtitle}
                titleStyle={styles.qualityLabel}
                subtitleStyle={styles.qualityDescription}
                // The tick alone marks the choice: gold at rest would make this the one
                // list in Settings that fills a row before anyone touches it.
                trailingIcon={selected ? tick : undefined}
                onPress={() => handleQualityChange(value)}
                onFocus={IS_TV ? (index === 0 ? pinListToTop : index === QUALITY_ROWS.length - 1 ? pinListToBottom : enter) : undefined}
                onBlur={IS_TV ? leave : undefined}
                isFirst={index === 0}
                moreBelow={IS_TV && index === lastVisible ? !focusedInside && moreBelow : undefined}
                accessibilityLabel={qualityLabel(value)}
                accessibilityHint={subtitle}
                accessibilityState={{ selected }}
              />
            );
          })}
        </ScrollView>
        <View onLayout={IS_TV ? (event) => setFooterHeight(event.nativeEvent.layout.height) : undefined}>
          <SectionFooter>
            <Text style={settingsStyles.sectionNote}>{t("settings.transcodeFooter")}</Text>
          </SectionFooter>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  qualityLabel: {
    lineHeight: QUALITY_TITLE_LINE_HEIGHT,
  },
  // marginTop 0 overrides ListRow's subtitle air: QUALITY_ROW_HEIGHT budgets only the title's
  // 2pt gap between the lines.
  qualityDescription: {
    fontSize: IS_TV ? 22 : IS_PAD ? 15 : 14,
    lineHeight: QUALITY_SUBTITLE_LINE_HEIGHT,
    marginTop: 0,
  },
});
