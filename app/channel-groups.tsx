import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { useChannelFilterChoices } from "@/hooks/useChannelFilterChoices";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { t } from "@/services/i18n";
import { updateLiveTvPreferences, type ChannelFilter } from "@/services/liveTvPreferences";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The channel wall's group picker: one sunken list, the picked group ticked, a press switches and returns. */
export default function ChannelGroupsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const choices = useChannelFilterChoices();
  const { filter } = useLiveTvPreferences();
  const [listHeight, setListHeight] = useState(0);
  const pick = useCallback(
    (next: ChannelFilter) => {
      updateLiveTvPreferences({ filter: next });
      router.back();
    },
    [router],
  );

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <View style={[styles.page, IS_TV ? styles.pageTV : { paddingTop: headerHeight + 12, paddingBottom: 60 + insets.bottom }]}>
        <View style={[settingsStyles.contentContainer, styles.column]}>
          {/* Phone reads the title off the native bar. */}
          {IS_TV ? (
            <View style={settingsStyles.sectionHeader}>
              <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.groups")}</Text>
            </View>
          ) : null}
          {/* The Diagnostics log's card: the list grows to its rows, capped at the room under the title, and scrolls inside. */}
          <View style={[styles.body, IS_TV && styles.bodyTV]} onLayout={(event) => setListHeight(event.nativeEvent.layout.height)}>
            <View style={[settingsStyles.section, styles.card]}>
              <ScrollView style={{ maxHeight: listHeight }} showsVerticalScrollIndicator={!IS_TV}>
                {choices.map((choice, index) => {
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
                })}
              </ScrollView>
            </View>
          </View>
        </View>
      </View>
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
  body: {
    flex: 1,
  },
  // TV: the card sits dead center in the room under the title.
  bodyTV: {
    justifyContent: "center",
  },
  card: {
    marginBottom: 0,
  },
});
