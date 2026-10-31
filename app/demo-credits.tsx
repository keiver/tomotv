import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { PosterMark } from "@/components/settings/PosterMark";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { CARD_HEADER_HEIGHT, SectionListCard, type RowGroup, type RowPlace } from "@/components/settings/SectionListCard";
import { IS_PAD, POSTER_ROW_HEIGHT, settingsStyles, sideInsets, SUBTITLE_LINE_HEIGHT, TITLE_LINE_HEIGHT } from "@/components/settings/styles";
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
  type DemoLicence,
} from "@/services/demoCredits";
import { t } from "@/services/i18n";
import { logger } from "@/utils/logger";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useEffect, useMemo, useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The footer line: when the server listed the items and where it publishes the list. */
export function generatedLine(credits: DemoCredits): string {
  const date = new Date(credits.generated);
  const when = Number.isNaN(date.getTime()) ? credits.generated : date.toLocaleDateString([], { dateStyle: "medium" });
  return t("demo.creditsGenerated").replace("{date}", when).replace("{url}", DEMO_CREDITS_URL);
}

function openPage(url: string) {
  void Linking.openURL(url).catch((error) => logger.warn("Credits link failed to open", error, { service: "DemoCreditsScreen" }));
}

type CreditRow = { item: DemoCredit; licence?: undefined } | { item?: undefined; licence: DemoLicence };

/** Whole rows that fill the screen's height under the intro, the first subgroup header and the card's footer budgeted. */
export function visibleCreditRows(viewport: number, listTop: number, footerHeight: number): number {
  const fit = Math.floor((viewport - listTop - footerHeight - CARD_HEADER_HEIGHT) / POSTER_ROW_HEIGHT);
  return Math.max(1, fit);
}

const itemKey = (item: DemoCredit) => `${item.library}/${item.title}`;
const rowKey = (row: CreditRow) => (row.item ? itemKey(row.item) : `licence/${row.licence.licence}`);

/**
 * Every item on the demo server with its maker, licence, source and picture, pushed from the
 * Demo credits row under About. One card for the whole list, a subgroup per library, and the
 * page itself never scrolls: the card's rows do. On phone and Mac a row opens its source page
 * and its trailing button the licence page. On TV nothing opens: the licence name sits at the
 * row's edge as plain text and a last subgroup lists each licence with its page. Opens on the
 * manifest the app ships, then asks the server
 * for its current one and swaps it in when it is newer; a server that does not answer changes
 * nothing. The Menu/back button pops the route.
 */
export default function DemoCreditsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [credits, setCredits] = useState<DemoCredits>(BUNDLED_DEMO_CREDITS);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [listTop, setListTop] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);

  useEffect(() => {
    let mounted = true;
    void fetchDemoCredits().then((fetched) => {
      if (mounted) setCredits((current) => newerManifest(current, fetched));
    });
    return () => {
      mounted = false;
    };
  }, []);

  const groups = useMemo<RowGroup<CreditRow>[]>(() => {
    const libraries: RowGroup<CreditRow>[] = creditLibraries(credits.items).map((group) => ({
      title: group.library,
      data: group.items.map((item) => ({ item })),
    }));
    if (!IS_TV) return libraries;
    return [...libraries, { title: t("demo.licencesHeader"), data: distinctLicences(credits.items).map((licence) => ({ licence })) }];
  }, [credits]);
  const firstKey = groups[0]?.data[0] ? rowKey(groups[0].data[0]) : null;

  // The list takes whole rows of the measured screen height, like the licenses list, so the
  // footer always lands on screen instead of depending on the card shrinking to fit.
  const measured = viewportHeight > 0 && footerHeight > 0;
  const listCap = measured ? { maxHeight: CARD_HEADER_HEIGHT + visibleCreditRows(viewportHeight, listTop, footerHeight) * POSTER_ROW_HEIGHT } : settingsStyles.demoCreditsScrollable;

  const renderRow = (row: CreditRow, place: RowPlace) => {
    if (row.licence) {
      const entry = row.licence;
      return (
        <ListRow
          icon="ribbon-outline"
          title={entry.licence}
          subtitle={entry.licenceUrl}
          titleStyle={styles.rowTitle}
          subtitleStyle={styles.rowSubtitle}
          onFocus={place.onFocus}
          onBlur={place.onBlur}
          isFirst={place.isFirst}
          isLast={place.isLast}
          moreBelow={place.moreBelow}
          accessibilityLabel={`${entry.licence}, ${entry.licenceUrl}`}
        />
      );
    }
    const item = row.item;
    return (
      <ListRow
        icon={item.image ? () => <PosterMark uri={item.image} /> : "film-outline"}
        title={item.title}
        subtitle={item.by}
        titleStyle={styles.rowTitle}
        subtitleStyle={styles.rowSubtitle}
        trailingAction={
          IS_TV ? undefined : { text: licenceShortName(item.licence), label: `${t("demo.licence")}: ${item.licence}`, hint: t("demo.licenceHint"), onPress: () => openPage(item.licenceUrl) }
        }
        trailingText={IS_TV ? licenceShortName(item.licence) : undefined}
        onPress={IS_TV ? undefined : () => openPage(item.source)}
        onFocus={place.onFocus}
        onBlur={place.onBlur}
        hasTVPreferredFocus={itemKey(item) === firstKey}
        isFirst={place.isFirst}
        isLast={place.isLast}
        moreBelow={place.moreBelow}
        accessibilityLabel={`${item.title}, ${item.by}, ${item.licence}`}
        accessibilityHint={IS_TV ? undefined : t("demo.sourceHint")}
      />
    );
  };

  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />
      {/* No fixed bottom padding: the card's own margin is the air to the screen edge, so its rows get the height. */}
      <View style={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: insets.bottom }, sideInsets(insets)]}>
        <View style={[settingsStyles.contentContainer, styles.content]} onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}>
          <View onLayout={(event) => setListTop(event.nativeEvent.layout.height)}>
            {/* Phone puts the title in the native bar; TV has no header. */}
            {IS_TV && <Text style={styles.title}>{t("settings.mediaLicenses")}</Text>}
            <Text style={styles.intro}>{t("demo.creditsIntro")}</Text>
          </View>
          <SectionListCard
            groups={groups}
            keyExtractor={rowKey}
            renderRow={renderRow}
            style={styles.card}
            listStyle={listCap}
            footer={
              <View onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}>
                <SectionFooter>
                  <Text style={settingsStyles.sectionNote}>{generatedLine(credits)}</Text>
                </SectionFooter>
              </View>
            }
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: "center",
  },
  content: {
    flex: 1,
  },
  card: {
    flexShrink: 1,
  },
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
  // Pinned leading on both lines: the list's height cap is POSTER_ROW_HEIGHT times a row
  // count, and that arithmetic only holds if every row measures what it assumes.
  rowTitle: {
    lineHeight: TITLE_LINE_HEIGHT,
  },
  // marginTop 0 overrides ListRow's subtitle air, which the row height does not budget for.
  rowSubtitle: {
    fontSize: IS_TV ? 22 : IS_PAD ? 15 : 14,
    lineHeight: SUBTITLE_LINE_HEIGHT,
    marginTop: 0,
  },
});
