import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { PosterMark } from "@/components/settings/PosterMark";
import { settingsStyles, sideInsets } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import {
  BUNDLED_DEMO_CREDITS,
  creditLibraries,
  DEMO_CREDITS_URL,
  distinctLicences,
  fetchDemoCredits,
  licenceShortName,
  newerManifest,
  type DemoCredit,
  type DemoCredits,
} from "@/services/demoCredits";
import { t } from "@/services/i18n";
import { logger } from "@/utils/logger";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** An item row's second line: the maker, and on TV the source page while the row is focused. */
export function itemSubtitle(item: DemoCredit, isTV: boolean, focused: boolean): string {
  return isTV && focused ? item.source : item.by;
}

/** The footer line: when the server listed the items and where it publishes the list. */
export function generatedLine(credits: DemoCredits): string {
  const date = new Date(credits.generated);
  const when = Number.isNaN(date.getTime()) ? credits.generated : date.toLocaleDateString([], { dateStyle: "medium" });
  return t("demo.creditsGenerated").replace("{date}", when).replace("{url}", DEMO_CREDITS_URL);
}

function openPage(url: string) {
  void Linking.openURL(url).catch((error) => logger.warn("Credits link failed to open", error, { service: "DemoCreditsScreen" }));
}

const itemKey = (item: DemoCredit) => `${item.library}/${item.title}`;

/**
 * Every item on the demo server with its maker, licence, source and picture, pushed from the
 * Demo credits row under About: one card per library, one row per item. On phone and Mac a
 * row opens its source page and its trailing button the licence page. On TV nothing opens: the
 * licence name sits at the row's edge as plain text, the focused row shows its source address,
 * and a last card lists each licence with its page. Opens
 * on the manifest the app ships, then asks the server for its current one and swaps it in when
 * it is newer; a server that does not answer changes nothing. The Menu/back button pops the route.
 */
export default function DemoCreditsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [credits, setCredits] = useState<DemoCredits>(BUNDLED_DEMO_CREDITS);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void fetchDemoCredits().then((fetched) => {
      if (mounted) setCredits((current) => newerManifest(current, fetched));
    });
    return () => {
      mounted = false;
    };
  }, []);

  const libraries = useMemo(() => creditLibraries(credits.items), [credits]);
  const licences = useMemo(() => distinctLicences(credits.items), [credits]);
  const blur = useCallback(() => setFocusedKey(null), []);

  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />
      <ScrollView
        style={settingsStyles.scrollView}
        contentContainerStyle={[
          settingsStyles.scrollContent,
          { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: settingsStyles.scrollContent.paddingBottom + insets.bottom },
          sideInsets(insets),
        ]}
        alwaysBounceVertical={IS_TV}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          {/* Phone puts the title in the native bar; TV has no header. */}
          {IS_TV && <Text style={styles.title}>{t("settings.mediaLicenses")}</Text>}
          <Text style={styles.intro}>{t("demo.creditsIntro")}</Text>

          {libraries.map((group, groupIndex) => (
            <View key={group.library}>
              <View style={settingsStyles.sectionHeader}>
                <Text style={settingsStyles.sectionHeaderText}>{group.library}</Text>
              </View>
              <View style={settingsStyles.section}>
                {group.items.map((item, index) => (
                  <ListRow
                    key={itemKey(item)}
                    icon={item.image ? () => <PosterMark uri={item.image} /> : "film-outline"}
                    title={item.title}
                    subtitle={itemSubtitle(item, IS_TV, focusedKey === itemKey(item))}
                    trailingAction={
                      IS_TV
                        ? undefined
                        : { text: licenceShortName(item.licence), label: `${t("demo.licence")}: ${item.licence}`, hint: t("demo.licenceHint"), onPress: () => openPage(item.licenceUrl) }
                    }
                    trailingText={IS_TV ? licenceShortName(item.licence) : undefined}
                    onPress={IS_TV ? undefined : () => openPage(item.source)}
                    onFocus={IS_TV ? () => setFocusedKey(itemKey(item)) : undefined}
                    onBlur={IS_TV ? blur : undefined}
                    hasTVPreferredFocus={groupIndex === 0 && index === 0}
                    isFirst={index === 0}
                    isLast={index === group.items.length - 1}
                    accessibilityLabel={`${item.title}, ${item.by}, ${item.licence}`}
                    accessibilityHint={IS_TV ? undefined : t("demo.sourceHint")}
                  />
                ))}
              </View>
            </View>
          ))}

          {IS_TV && (
            <>
              <View style={settingsStyles.sectionHeader}>
                <Text style={settingsStyles.sectionHeaderText}>{t("demo.licencesHeader")}</Text>
              </View>
              <View style={settingsStyles.section}>
                {licences.map((entry, index) => (
                  <ListRow
                    key={entry.licence}
                    icon="ribbon-outline"
                    title={entry.licence}
                    subtitle={entry.licenceUrl}
                    isFirst={index === 0}
                    isLast={index === licences.length - 1}
                    accessibilityLabel={`${entry.licence}, ${entry.licenceUrl}`}
                  />
                ))}
              </View>
            </>
          )}

          <Text style={styles.footer}>{generatedLine(credits)}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 44,
    fontWeight: "800",
    color: COLORS.TEXT_PRIMARY,
    letterSpacing: -1,
    marginBottom: 24,
    marginHorizontal: 16,
  },
  intro: {
    fontSize: IS_TV ? 22 : 14,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: IS_TV ? 30 : 20,
    marginBottom: IS_TV ? 12 : 6,
    marginHorizontal: IS_TV ? 16 : 8,
  },
  footer: {
    fontSize: IS_TV ? 18 : 12,
    lineHeight: IS_TV ? 26 : 17,
    color: COLORS.TEXT_TERTIARY,
    marginTop: IS_TV ? 24 : 16,
    marginHorizontal: IS_TV ? 16 : 8,
  },
});
