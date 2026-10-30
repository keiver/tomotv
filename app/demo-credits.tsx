import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles, sideInsets } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { BUNDLED_DEMO_CREDITS, DEMO_CREDITS_URL, fetchDemoCredits, groupCredits, newerManifest, type DemoCredit, type DemoCredits } from "@/services/demoCredits";
import { t } from "@/services/i18n";
import { logger } from "@/utils/logger";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The row's second line: maker, year when the item has one, licence. */
export function creditSubtitle(item: DemoCredit): string {
  return [item.by, item.year ? String(item.year) : null, item.licence].filter(Boolean).join(" · ");
}

/** The footer line: when the server listed the items and where it publishes the list. */
export function generatedLine(credits: DemoCredits): string {
  const date = new Date(credits.generated);
  const when = Number.isNaN(date.getTime()) ? credits.generated : date.toLocaleDateString([], { dateStyle: "medium" });
  return t("demo.creditsGenerated").replace("{date}", when).replace("{url}", DEMO_CREDITS_URL);
}

/**
 * A source or licence page under an expanded row. On TV it is a focus stop the remote can
 * read, with nothing behind it; on phone and Mac it opens the page.
 */
function PageLink({ label, url }: { label: string; url: string }) {
  const open = useCallback(() => {
    void Linking.openURL(url).catch((error) => logger.warn("Credits link failed to open", error, { service: "DemoCreditsScreen" }));
  }, [url]);
  if (IS_TV) {
    return (
      <Pressable isTVSelectable={true} accessibilityRole="text" style={({ focused }) => [styles.link, focused && styles.linkFocused]}>
        {({ focused }) => (
          <Text style={[styles.linkText, focused && styles.linkTextFocused]}>
            {label}: {url}
          </Text>
        )}
      </Pressable>
    );
  }
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${label}: ${url}`} accessibilityHint={t("demo.sourceHint")} onPress={open} style={styles.link}>
      <Text style={[styles.linkText, styles.linkTextPhone]}>
        {label}: {url}
      </Text>
    </Pressable>
  );
}

/**
 * Every item on the demo server with its maker, licence and source, pushed from the Media Licenses
 * row under About. Opens on the manifest the app ships, then asks the server for its current one
 * and swaps it in when it is newer; a server that does not answer changes nothing. Selecting a
 * row shows its licence and the pages it was read from. The Menu/back button pops the route.
 */
export default function DemoCreditsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [credits, setCredits] = useState<DemoCredits>(BUNDLED_DEMO_CREDITS);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void fetchDemoCredits().then((fetched) => {
      if (mounted) setCredits((current) => newerManifest(current, fetched));
    });
    return () => {
      mounted = false;
    };
  }, []);

  const groups = useMemo(() => groupCredits(credits.items), [credits]);
  const toggle = useCallback((key: string) => setExpandedKey((previous) => (previous === key ? null : key)), []);

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

          {groups.map((group, groupIndex) => (
            <View key={group.library}>
              <View style={settingsStyles.sectionHeader}>
                <Text style={settingsStyles.sectionHeaderText}>{group.library}</Text>
              </View>
              <View style={settingsStyles.section}>
                {group.items.map((item, index) => {
                  const key = `${item.library}/${item.title}`;
                  const expanded = expandedKey === key;
                  return (
                    <View key={key}>
                      <ListRow
                        title={item.title}
                        subtitle={creditSubtitle(item)}
                        subtitleLines={2}
                        trailingIcon={expanded ? "chevron-up" : "chevron-down"}
                        onPress={() => toggle(key)}
                        hasTVPreferredFocus={groupIndex === 0 && index === 0}
                        isFirst={index === 0}
                        isLast={index === group.items.length - 1 && !expanded}
                        accessibilityLabel={`${item.title}, ${creditSubtitle(item)}`}
                        accessibilityState={{ expanded }}
                        accessibilityHint={t("demo.creditsRowHint")}
                      />
                      {expanded && (
                        <View style={styles.body}>
                          <Text style={styles.licence}>{item.licence}</Text>
                          <PageLink label={t("demo.source")} url={item.source} />
                          {item.licenceUrl !== item.source && <PageLink label={t("demo.licence")} url={item.licenceUrl} />}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
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
  body: {
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    paddingVertical: IS_TV ? 16 : 10,
    paddingHorizontal: IS_TV ? 24 : 16,
  },
  licence: {
    fontSize: IS_TV ? 22 : 13,
    lineHeight: IS_TV ? 30 : 18,
    color: COLORS.TEXT_BODY,
    marginBottom: IS_TV ? 10 : 6,
  },
  // TV: a focus stop so the remote can reach the address; phone: a link.
  link: {
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginHorizontal: -12,
  },
  linkFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  linkText: {
    fontSize: IS_TV ? 20 : 12,
    lineHeight: IS_TV ? 28 : 17,
    color: COLORS.TEXT_SECONDARY,
  },
  linkTextFocused: {
    color: COLORS.TEXT_BRIGHT,
  },
  linkTextPhone: {
    color: COLORS.ACCENT,
  },
  footer: {
    fontSize: IS_TV ? 18 : 12,
    lineHeight: IS_TV ? 26 : 17,
    color: COLORS.TEXT_TERTIARY,
    marginTop: IS_TV ? 24 : 16,
    marginHorizontal: IS_TV ? 16 : 8,
  },
});
