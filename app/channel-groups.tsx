import { AmbientBackground } from "@/components/ambient-background";
import { ChannelGroupSection } from "@/components/live-tv/channel-group-section";
import { PadSheet } from "@/components/pad-sheet";
import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { useChannelFilterChoices } from "@/hooks/useChannelFilterChoices";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { t } from "@/services/i18n";
import { COLORS } from "@/constants/colors";
import { updateLiveTvPreferences, type ChannelFilter, type ChannelIdentity } from "@/services/liveTvPreferences";
import { Stack, useLocalSearchParams, useRouter, type NativeStackNavigationOptions } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
// iPad presents the picker over the app as the info panel's fitted card.
const IS_PAD = !IS_TV && Platform.OS === "ios" && Platform.isPad;

/**
 * The channel wall's group picker: one sunken list, the picked group ticked, a press switches and returns.
 * Opened with a channel, it holds the channel's favorite and groups instead, and a ✕ closes it.
 */
export default function ChannelGroupsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const choices = useChannelFilterChoices();
  const { filter } = useLiveTvPreferences();
  const params = useLocalSearchParams<{ channelId?: string; channelName?: string; channelNumber?: string }>();
  const channel = useMemo<ChannelIdentity | null>(
    () => (params.channelName ? { Id: params.channelId, Name: params.channelName, ChannelNumber: params.channelNumber } : null),
    [params.channelId, params.channelName, params.channelNumber],
  );
  const [roomHeight, setRoomHeight] = useState(0);
  const [titleHeight, setTitleHeight] = useState(0);
  const pick = useCallback(
    (next: ChannelFilter) => {
      updateLiveTvPreferences({ filter: next });
      router.back();
    },
    [router],
  );
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      unstable_headerRightItems: () => [{ type: "button", label: t("common.close"), icon: { type: "sfSymbol", name: "xmark" }, tintColor: COLORS.ACCENT, onPress: () => router.back() }],
    }),
    [router],
  );

  const choiceRows = choices.map((choice, index) => {
    const picked = choice.filter === filter;
    return (
      <ListRow
        key={choice.filter}
        title={choice.label}
        trailingIcon={picked ? tick : undefined}
        onPress={() => pick(choice.filter)}
        hasTVPreferredFocus={picked}
        accessibilityState={{ selected: picked }}
        isFirst={index === 0}
        isLast={index === choices.length - 1}
      />
    );
  });

  if (IS_PAD) {
    return (
      <PadSheet onClose={() => router.back()} fit="center">
        <ScrollView style={styles.padScroll} contentContainerStyle={styles.padContent} keyboardShouldPersistTaps="handled">
          <View style={styles.padTitle}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.groups")}</Text>
          </View>
          {channel ? <ChannelGroupSection channel={channel} /> : <View style={[settingsStyles.section, styles.card]}>{choiceRows}</View>}
        </ScrollView>
      </PadSheet>
    );
  }

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <View style={[styles.page, IS_TV ? styles.pageTV : { paddingTop: headerHeight + 12, paddingBottom: 60 + insets.bottom }]}>
        {/* The Diagnostics log's card: the list grows to its rows, capped at the room under the title, and scrolls inside. */}
        <View style={[settingsStyles.contentContainer, styles.column, IS_TV && styles.columnTV]} onLayout={(event) => setRoomHeight(event.nativeEvent.layout.height)}>
          {/* Phone reads the title off the native bar. */}
          {IS_TV ? (
            <View style={settingsStyles.sectionHeader} onLayout={(event) => setTitleHeight(event.nativeEvent.layout.height)}>
              <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.groups")}</Text>
            </View>
          ) : null}
          {channel ? (
            <ScrollView style={{ maxHeight: Math.max(0, roomHeight - titleHeight) }} showsVerticalScrollIndicator={!IS_TV} keyboardShouldPersistTaps="handled">
              <ChannelGroupSection channel={channel} />
            </ScrollView>
          ) : (
            <View style={[settingsStyles.section, styles.card]}>
              <ScrollView style={{ maxHeight: Math.max(0, roomHeight - titleHeight) }} showsVerticalScrollIndicator={!IS_TV}>
                {choiceRows}
              </ScrollView>
            </View>
          )}
        </View>
      </View>
      {channel && !IS_TV && <Stack.Screen options={screenOptions} />}
    </View>
  );
}

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
  // flexGrow 0 sizes the card to its rows, scrolling only past its max height.
  padScroll: {
    flexGrow: 0,
  },
  padContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
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
