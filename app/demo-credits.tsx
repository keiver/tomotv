import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { PosterMark } from "@/components/settings/PosterMark";
import { settingsStyles, sideInsets } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { BUNDLED_DEMO_CREDITS, creditSections, DEMO_CREDITS_URL, fetchDemoCredits, newerManifest, type DemoCredit, type DemoCreditGroup, type DemoCredits } from "@/services/demoCredits";
import { t } from "@/services/i18n";
import { logger } from "@/utils/logger";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The group row's second line: the licence, and on TV the page it is read from, since the row cannot open it. */
export function groupSubtitle(group: DemoCreditGroup, isTV: boolean): string {
  return isTV ? `${group.licence} · ${group.licenceUrl}` : group.licence;
}

/** An item row's second line: on TV its source page, elsewhere its year when it has one. */
export function itemSubtitle(item: DemoCredit, isTV: boolean): string | undefined {
  if (isTV) return item.source;
  return item.year ? String(item.year) : undefined;
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

/**
 * Every item on the demo server with its maker, licence, source and picture, pushed from the
 * Media Licenses row under About. Each library is a header; under it one card per maker and
 * licence, led by a row that opens the licence page, then a nested row per item that opens its
 * source page. Opens on the manifest the app ships, then asks the server for its current one and
 * swaps it in when it is newer; a server that does not answer changes nothing. The Menu/back
 * button pops the route.
 */
export default function DemoCreditsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [credits, setCredits] = useState<DemoCredits>(BUNDLED_DEMO_CREDITS);

  useEffect(() => {
    let mounted = true;
    void fetchDemoCredits().then((fetched) => {
      if (mounted) setCredits((current) => newerManifest(current, fetched));
    });
    return () => {
      mounted = false;
    };
  }, []);

  const sections = useMemo(() => creditSections(credits.items), [credits]);
  const openLicence = useCallback((group: DemoCreditGroup) => openPage(group.licenceUrl), []);
  const openSource = useCallback((item: DemoCredit) => openPage(item.source), []);

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

          {sections.map((section, sectionIndex) => (
            <View key={section.library}>
              <View style={settingsStyles.sectionHeader}>
                <Text style={settingsStyles.sectionHeaderText}>{section.library}</Text>
              </View>
              {section.groups.map((group, groupIndex) => (
                <View key={`${section.library}/${group.by}/${group.licence}`} style={settingsStyles.section}>
                  <ListRow
                    icon="ribbon-outline"
                    title={group.by}
                    subtitle={groupSubtitle(group, IS_TV)}
                    trailingIcon={IS_TV ? undefined : "open-outline"}
                    onPress={() => openLicence(group)}
                    hasTVPreferredFocus={sectionIndex === 0 && groupIndex === 0}
                    isFirst
                    accessibilityLabel={`${group.by}, ${group.licence}`}
                    accessibilityHint={t("demo.licenceHint")}
                  />
                  {group.items.map((item, index) => (
                    <ListRow
                      key={`${item.library}/${item.title}`}
                      nested
                      icon={item.image ? () => <PosterMark uri={item.image} /> : "film-outline"}
                      title={item.title}
                      subtitle={itemSubtitle(item, IS_TV)}
                      trailingIcon={IS_TV ? undefined : "open-outline"}
                      onPress={() => openSource(item)}
                      isLast={index === group.items.length - 1}
                      accessibilityLabel={item.year ? `${item.title}, ${item.year}` : item.title}
                      accessibilityHint={t("demo.sourceHint")}
                    />
                  ))}
                </View>
              ))}
            </View>
          ))}

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
