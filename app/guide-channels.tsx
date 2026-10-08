import { AmbientBackground } from "@/components/ambient-background";
import { PadSheet } from "@/components/pad-sheet";
import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { StorageBar } from "@/components/storage-bar";
import { COLORS } from "@/constants/colors";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { guideSourceStatuses, subscribeGuideSources } from "@/services/externalGuide";
import { t } from "@/services/i18n";
import type { StringKey } from "@/services/i18n/strings";
import type { MatchVia } from "@/utils/guideMatch";
import { guideChannelRows, guideSourceSummary } from "@/utils/guideSources";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useMemo, useState, useSyncExternalStore } from "react";
import { FlatList, Platform, StyleSheet, Text, View, type ListRenderItem } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
// iPad presents the list over the app as the group picker's fitted card.
const IS_PAD = !IS_TV && Platform.OS === "ios" && Platform.isPad;

type GuideChannelRow = ReturnType<typeof guideChannelRows>[number];

const VIA_LABEL: Record<MatchVia, StringKey> = {
  id: "liveTv.matchedById",
  tvgName: "liveTv.matchedByTvgName",
  name: "liveTv.matchedByName",
};

/** Every channel asked of one guide and how it matched, in the group picker's sunken card. */
export default function GuideChannelsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { url = "" } = useLocalSearchParams<{ url?: string }>();
  const statuses = useSyncExternalStore(subscribeGuideSources, guideSourceStatuses);
  const channels = useMemo(() => guideChannelRows(statuses[url]), [statuses, url]);
  const { guideSourcesOff } = useLiveTvPreferences();
  const summary = guideSourceSummary(statuses[url], !guideSourcesOff.includes(url), t);
  const [roomHeight, setRoomHeight] = useState(0);
  const [titleHeight, setTitleHeight] = useState(0);
  const [gaugeHeight, setGaugeHeight] = useState(0);

  const renderItem: ListRenderItem<GuideChannelRow> = ({ item, index }) => (
    <ListRow
      icon={item.via ? "tv-outline" : "close-circle-outline"}
      title={item.name}
      subtitle={t(item.via ? VIA_LABEL[item.via] : "liveTv.notMatched")}
      hasTVPreferredFocus={index === 0}
      isFirst={index === 0}
      isLast={summary.meter === undefined && index === channels.length - 1}
    />
  );
  // Virtualised: a catalog playlist asks thousands of channels of one guide.
  const list = (style: object) => (
    <FlatList data={channels} keyExtractor={channelKey} renderItem={renderItem} style={style} initialNumToRender={12} maxToRenderPerBatch={8} windowSize={5} showsVerticalScrollIndicator={!IS_TV} />
  );
  // Successful matches fill the read-only gauge green as the card runs out into it.
  const gauge =
    summary.meter !== undefined ? (
      <View onLayout={(event) => setGaugeHeight(event.nativeEvent.layout.height)}>
        <StorageBar used={summary.meter} free={1 - summary.meter} label={summary.subtitle} fillColor={COLORS.SUCCESS} />
      </View>
    ) : null;

  if (IS_PAD) {
    return (
      <PadSheet onClose={() => router.back()} fit="center">
        <View style={styles.padContent}>
          <View style={styles.padTitle}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.matchedChannels")}</Text>
          </View>
          <View style={[settingsStyles.section, styles.card, styles.padCard]}>
            {list(styles.padList)}
            {gauge}
          </View>
        </View>
      </PadSheet>
    );
  }

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <View style={[styles.page, IS_TV ? styles.pageTV : { paddingTop: headerHeight + 12, paddingBottom: 60 + insets.bottom }]}>
        <View style={[settingsStyles.contentContainer, styles.column, IS_TV && styles.columnTV]} onLayout={(event) => setRoomHeight(event.nativeEvent.layout.height)}>
          {/* Phone reads the title off the native bar. */}
          {IS_TV ? (
            <View style={settingsStyles.sectionHeader} onLayout={(event) => setTitleHeight(event.nativeEvent.layout.height)}>
              <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.matchedChannels")}</Text>
            </View>
          ) : null}
          <View style={[settingsStyles.section, styles.card]}>
            {list({ maxHeight: Math.max(0, roomHeight - titleHeight - gaugeHeight) })}
            {gauge}
          </View>
        </View>
      </View>
    </View>
  );
}

const channelKey = (channel: GuideChannelRow) => channel.channelId;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  page: {
    flex: 1,
    alignItems: "center",
  },
  pageTV: {
    paddingVertical: 60,
  },
  column: {
    flex: 1,
  },
  // TV: title and card sit together, dead center.
  columnTV: {
    justifyContent: "center",
  },
  card: {
    marginBottom: 0,
  },
  padContent: {
    flexShrink: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  // The sheet's max height squeezes the card, and the list scrolls inside it.
  padCard: {
    flexShrink: 1,
  },
  padList: {
    flexGrow: 0,
  },
  // Level with the card's floating ✕ and clear of it.
  padTitle: {
    minHeight: 44,
    marginTop: 12,
    marginRight: 40,
    marginBottom: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
});
