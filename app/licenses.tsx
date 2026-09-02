import { AmbientBackground } from "@/components/ambient-background";
import { AccountPill } from "@/components/settings/AccountPill";
import { ListRow } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { IS_PAD, QUALITY_SUBTITLE_LINE_HEIGHT, QUALITY_TITLE_LINE_HEIGHT, settingsStyles } from "@/components/settings/styles";
import { APP_ABOUT_LINE, APP_BUILD_LABEL } from "@/constants/app";
import { BUNDLED_PACKAGES, BUNDLED_PACKAGES_DECLARED_ONLY } from "@/constants/bundled-licenses";
import { COLORS } from "@/constants/colors";
import { CREDITS, LGPL3_NOTE, LGPL_SOURCE_NOTICE, LICENSE_TEXTS, type Credit } from "@/constants/licenses";
import { licenseParagraphs } from "@/utils/licenseParagraphs";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

const BUNDLED_PACKAGE_COUNT = BUNDLED_PACKAGES.length + BUNDLED_PACKAGES_DECLARED_ONLY.length;

/**
 * Open-source acknowledgements, pushed from the Help tab. One focusable row
 * per component; selecting a row expands the full license text inline below
 * it. On TV every paragraph of the expanded text is itself focusable: focus
 * walks paragraph by paragraph and the ScrollView follows, which is the only
 * way remote users can actually read a license longer than one screen (a
 * single non-focusable block gets jumped over row-to-row). The Menu/back
 * button pops the route natively.
 */
export default function LicensesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [expandedName, setExpandedName] = useState<string | null>(null);

  const toggle = useCallback((credit: Credit) => {
    setExpandedName((prev) => (prev === credit.name ? null : credit.name));
  }, []);

  const credits = CREDITS.map((credit, index) => {
    const expanded = expandedName === credit.name;
    return (
      <View key={credit.name}>
        <ListRow
          title={credit.name}
          subtitle={`${credit.role} · ${credit.licenseLabel}`}
          trailingIcon={expanded ? "chevron-up" : "chevron-down"}
          onPress={() => toggle(credit)}
          // Pinned leading: the phone cap is QUALITY_ROW_HEIGHT times a row count.
          titleStyle={screenStyles.rowTitle}
          subtitleStyle={screenStyles.rowSubtitle}
          hasTVPreferredFocus={index === 0}
          isFirst={index === 0}
          isLast={index === CREDITS.length - 1 && !expanded}
          accessibilityLabel={`${credit.name}, ${credit.licenseLabel}`}
          accessibilityState={{ expanded }}
          accessibilityHint={expanded ? "Collapses the license text" : "Expands the license text"}
        />

        {expanded && (
          <View style={[screenStyles.licenseBody, index === CREDITS.length - 1 && screenStyles.licenseBodyLast]}>
            {credit.copyright ? <Text style={screenStyles.copyright}>{credit.copyright}</Text> : null}
            {credit.license === "LGPL-3.0" ? <Text style={screenStyles.copyright}>{LGPL3_NOTE}</Text> : null}
            {IS_TV ? (
              licenseParagraphs(LICENSE_TEXTS[credit.license]).map((paragraph, paragraphIndex) => (
                // Role "text": focusable only so the remote can walk the license, with no
                // action behind it — a button trait would promise one.
                <Pressable key={paragraphIndex} isTVSelectable={true} accessibilityRole="text" style={({ focused }) => [screenStyles.paragraph, focused && screenStyles.paragraphFocused]}>
                  {({ focused }) => <Text style={[screenStyles.licenseText, focused && screenStyles.licenseTextFocused]}>{paragraph}</Text>}
                </Pressable>
              ))
            ) : (
              <Text style={screenStyles.licenseText}>{LICENSE_TEXTS[credit.license]}</Text>
            )}
          </View>
        )}
      </View>
    );
  });

  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />
      <ScrollView
        style={settingsStyles.scrollView}
        contentContainerStyle={[settingsStyles.scrollContent, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: 60 + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          {/* Phone puts this in the native bar; TV has no header. */}
          {IS_TV && <Text style={screenStyles.title}>Open Source</Text>}
          <View style={screenStyles.build}>
            <AccountPill label={`v${APP_BUILD_LABEL}`} onGold={false} />
            <AccountPill label={APP_ABOUT_LINE} onGold={false} />
          </View>
          <Text style={screenStyles.intro}>The playback engine stands on these projects. Select one to read its license.</Text>

          {/* Phone caps the card and scrolls the rows inside it (creditsScrollable). TV keeps the
              page scrolling: focus walks the expanded paragraphs, and a nested scroll view under
              them is unverified on a device. */}
          <View style={settingsStyles.section}>
            {IS_TV ? (
              credits
            ) : (
              <ScrollView style={settingsStyles.creditsScrollable} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                {credits}
              </ScrollView>
            )}
          </View>

          {/* The npm tree is hundreds of packages and cannot be curated by hand, so it
              lives on its own generated route. See scripts/generate-licenses.mjs. */}
          <View style={settingsStyles.section}>
            <ListRow
              title="Bundled Packages"
              subtitle={`${BUNDLED_PACKAGE_COUNT} open-source packages · full license text`}
              trailingIcon="chevron-forward"
              onPress={() => router.push("/bundled-licenses")}
              isFirst
              accessibilityRole="link"
              accessibilityLabel={`Bundled packages, ${BUNDLED_PACKAGE_COUNT} open source packages, full license text`}
              accessibilityHint="Opens the full third-party license list"
            />
            <SectionFooter>
              <Text style={settingsStyles.sectionNote}>{LGPL_SOURCE_NOTICE}</Text>
            </SectionFooter>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const screenStyles = StyleSheet.create({
  title: {
    fontSize: IS_TV ? 44 : 28,
    fontWeight: "800",
    color: COLORS.TEXT_PRIMARY,
    letterSpacing: -1,
    marginBottom: IS_TV ? 10 : 6,
    marginLeft: IS_TV ? 16 : 8,
  },
  // The running binary, first on the page: what this page credits is what that build ships.
  build: {
    alignItems: "center",
    gap: IS_TV ? 8 : 6,
    marginBottom: IS_TV ? 16 : 12,
  },
  intro: {
    fontSize: IS_TV ? 22 : 14,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: IS_TV ? 30 : 20,
    marginBottom: IS_TV ? 28 : 18,
    marginHorizontal: IS_TV ? 16 : 8,
  },
  rowTitle: {
    lineHeight: QUALITY_TITLE_LINE_HEIGHT,
  },
  // marginTop 0 overrides ListRow's subtitle air, which QUALITY_ROW_HEIGHT does not budget.
  rowSubtitle: {
    fontSize: IS_TV ? 22 : IS_PAD ? 15 : 14,
    lineHeight: QUALITY_SUBTITLE_LINE_HEIGHT,
    marginTop: 0,
  },
  licenseBody: {
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    paddingVertical: IS_TV ? 20 : 14,
    paddingHorizontal: IS_TV ? 24 : 16,
  },
  // The last credit's body becomes the card's own bottom edge, and it carries an opaque-enough
  // fill to draw a corner of its own. Rounded to the card's radius so it can never square off
  // the card while the row it replaced hands the corner over.
  licenseBodyLast: {
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  copyright: {
    fontSize: IS_TV ? 22 : 12,
    fontWeight: "600",
    color: COLORS.TEXT_BODY,
    marginBottom: 12,
  },
  // TV: each paragraph is a focus stop so the remote can walk the text.
  paragraph: {
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginHorizontal: -12,
  },
  paragraphFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  licenseText: {
    fontSize: IS_TV ? 24 : 11,
    lineHeight: IS_TV ? 34 : 17,
    color: COLORS.TEXT_SECONDARY,
    fontVariant: ["tabular-nums"],
  },
  licenseTextFocused: {
    color: COLORS.TEXT_BRIGHT,
  },
});
