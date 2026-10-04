import { AmbientBackground } from "@/components/ambient-background";
import { LinkLadder } from "@/components/settings/LinkLadder";
import { LinkSpeedHeading } from "@/components/settings/LinkSpeedHeading";
import { ListRow } from "@/components/settings/ListRow";
import { QualityMark } from "@/components/settings/QualityMark";
import { QUALITY_ROWS, qualityLabel, qualityRowSubtitle } from "@/components/settings/qualityRows";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { IS_PAD, QUALITY_SUBTITLE_LINE_HEIGHT, QUALITY_TITLE_LINE_HEIGHT, settingsStyles, TV_PUSHED_HEADER_TOP } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { carriedRungs, ORIGINAL_INDEX } from "@/services/adaptiveQuality";
import { t } from "@/services/i18n";
import { measureIfIdle, remeasureBitrate, rememberedBitrateStatus } from "@/services/jellyfin/bitrateTest";
import { STORAGE_KEYS } from "@/services/jellyfin/constants";
import { logger } from "@/utils/logger";
import { useHeaderHeight } from "expo-router/react-navigation";
import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The quality the server transcodes at, under the connection it measures. A press applies at once and the page stays. */
export default function QualityScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  // Default mirrors DEFAULT_QUALITY in jellyfinApi.ts (Original), so the ticked row matches
  // what playback actually uses before a choice is saved.
  const [videoQuality, setVideoQuality] = useState(5);
  const [measuredBps, setMeasuredBps] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [headingFocused, setHeadingFocused] = useState(false);

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
      setMeasuring(true);
      const bps = await measureIfIdle();
      if (cancelled) return;
      if (bps != null) setMeasuredBps(bps);
      setMeasuring(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRemeasure = useCallback(() => {
    if (measuring) return;
    setMeasuring(true);
    void (async () => {
      const bps = await remeasureBitrate();
      if (bps != null) setMeasuredBps(bps);
      setMeasuring(false);
    })();
  }, [measuring]);

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
  const pagePadding = { paddingTop: IS_TV ? TV_PUSHED_HEADER_TOP + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom };

  const content = (
    <View style={settingsStyles.contentContainer}>
      <LinkSpeedHeading measuredBps={measuredBps} measuring={measuring} onRemeasure={handleRemeasure} onFocus={() => setHeadingFocused(true)} onBlur={() => setHeadingFocused(false)} />
      <View style={[settingsStyles.section, headingFocused && settingsStyles.sectionCapped]}>
        {QUALITY_ROWS.map((value, index) => {
          const selected = videoQuality === value;
          const subtitle = qualityRowSubtitle(value, measuredBps);
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
              hasTVPreferredFocus={selected}
              isFirst={index === 0}
              accessibilityLabel={qualityLabel(value)}
              accessibilityHint={subtitle}
              accessibilityState={{ selected }}
            />
          );
        })}
        <SectionFooter>
          <Text style={settingsStyles.sectionNote}>{t("settings.transcodeFooter")}</Text>
        </SectionFooter>
      </View>
    </View>
  );

  // TV holds the page still under the tab screens' header line, as the pushed server list does.
  return (
    <View style={styles.container}>
      <AmbientBackground />
      {IS_TV ? (
        <View style={[styles.page, pagePadding]}>{content}</View>
      ) : (
        <ScrollView contentContainerStyle={[styles.page, pagePadding]} showsVerticalScrollIndicator={false}>
          {content}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  page: {
    alignItems: "center",
  },
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
