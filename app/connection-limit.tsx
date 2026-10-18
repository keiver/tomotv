import { AmbientBackground } from "@/components/ambient-background";
import { DurationChips } from "@/components/settings/DurationChips";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { IS_PAD, settingsStyles, sideInsets } from "@/components/settings/styles";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { t } from "@/services/i18n";
import { setConnectionLimit, type ConnectionLimit } from "@/services/liveTvPreferences";
import { limitOptions } from "@/utils/connectionLimits";
import { guideHost } from "@/utils/guideSources";
import { Stack, useLocalSearchParams, type NativeStackNavigationOptions } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useMemo } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** One tuner playlist: the streams its provider allows this device at once, or Auto to learn it from the provider. */
export default function ConnectionLimitScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { url = "" } = useLocalSearchParams<{ url?: string }>();
  const preferences = useLiveTvPreferences();
  const selected = preferences.connectionLimits[url] ?? 0;
  // Built per render, not at import: a module constant keeps the language it was first loaded in.
  const options = limitOptions(t);
  const pick = useCallback((limit: ConnectionLimit | 0) => setConnectionLimit(url, limit), [url]);
  // Phone: the host names the screen; the back button already says Connection limits.
  const screenOptions = useMemo<NativeStackNavigationOptions>(() => ({ headerTitle: guideHost(url) }), [url]);

  return (
    <View style={settingsStyles.screenContainer}>
      {IS_TV ? null : <Stack.Screen options={screenOptions} />}
      <AmbientBackground />
      <ScrollView
        style={settingsStyles.scrollView}
        contentContainerStyle={[
          settingsStyles.scrollContent,
          { paddingTop: IS_TV ? 40 + insets.top : headerHeight + (IS_PAD ? 24 : 12), paddingBottom: (IS_TV ? 60 : 24) + insets.bottom },
          sideInsets(insets),
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText} numberOfLines={1}>
              {t("liveTv.connectionLimit").replace("{host}", guideHost(url))}
            </Text>
          </View>
          <View style={settingsStyles.section}>
            <DurationChips options={options} selected={selected} onSelect={pick} focusSelected />
            <SectionFooter>
              <Text style={settingsStyles.sectionNote}>{t("liveTv.connectionLimitHint")}</Text>
            </SectionFooter>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
