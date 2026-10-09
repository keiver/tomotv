import { AmbientBackground } from "@/components/ambient-background";
import { AccountPill } from "@/components/settings/AccountPill";
import { ListRow } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { IS_PAD, QUALITY_ROW_HEIGHT, QUALITY_SUBTITLE_LINE_HEIGHT, QUALITY_TITLE_LINE_HEIGHT, settingsStyles } from "@/components/settings/styles";
import { APP_ABOUT_LINE, APP_BUILD_LABEL } from "@/constants/app";
import { BUNDLED_PACKAGES, BUNDLED_PACKAGES_DECLARED_ONLY } from "@/constants/bundled-licenses";
import { COLORS } from "@/constants/colors";
import { CREDITS, LGPL3_NOTE, LGPL_SOURCE_NOTICE, LICENSE_TEXTS, type Credit } from "@/constants/licenses";
import { APP_PLATFORM } from "@/utils/hostEnvironment";
import { licenseParagraphs } from "@/utils/licenseParagraphs";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "@/services/i18n";

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
  const [viewportHeight, setViewportHeight] = useState(0);
  const [listTop, setListTop] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);

  const pagePadding = { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: 60 + insets.bottom };
  // Phone: the list takes the whole rows left under the intro, so the page itself never scrolls.
  const fitRows = Math.floor((viewportHeight - pagePadding.paddingTop - pagePadding.paddingBottom - listTop - footerHeight - settingsStyles.section.marginBottom) / QUALITY_ROW_HEIGHT);
  const phoneListCap = !IS_TV && viewportHeight > 0 ? { maxHeight: Math.max(1, fitRows) * QUALITY_ROW_HEIGHT } : null;

  const toggle = useCallback((credit: Credit) => {
    setExpandedName((prev) => (prev === credit.name ? null : credit.name));
  }, []);

  // tvOS refuses a focus update leaving a ScrollView that is scrolled even slightly
  // (RCTScrollViewComponentView.shouldUpdateFocusInContext), so Down off the list's last
  // focusable would only scroll it. Pin the offset to the end there and focus can leave.
  const creditsRef = useRef<ScrollView>(null);
  const pinListToBottom = useCallback(() => {
    creditsRef.current?.scrollToEnd({ animated: false });
  }, []);

  const credits = CREDITS.map((credit, index) => {
    const expanded = expandedName === credit.name;
    const paragraphs = expanded && IS_TV ? licenseParagraphs(LICENSE_TEXTS[credit.license]) : [];
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
          accessibilityLabel={`${credit.name}, ${credit.licenseLabel}`}
          accessibilityState={{ expanded }}
          accessibilityHint={expanded ? t("licenses.collapseText") : t("licenses.expandText")}
        />

        {expanded && (
          <View style={screenStyles.licenseBody}>
            {credit.copyright ? <Text style={screenStyles.copyright}>{credit.copyright}</Text> : null}
            {credit.license === "LGPL-3.0" ? <Text style={screenStyles.copyright}>{LGPL3_NOTE}</Text> : null}
            {IS_TV ? (
              paragraphs.map((paragraph, paragraphIndex) => (
                // Role "text": focusable only so the remote can walk the license, with no
                // action behind it, and a button trait would promise one.
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
        contentContainerStyle={[settingsStyles.scrollContent, pagePadding]}
        onLayout={IS_TV ? undefined : (event) => setViewportHeight(event.nativeEvent.layout.height)}
        alwaysBounceVertical={IS_TV}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          <View style={screenStyles.build}>
            {__DEV__ ? <AccountPill label="DEV" onGold={false} tag={{ tint: COLORS.SUCCESS }} /> : null}
            <AccountPill label={APP_PLATFORM} onGold={false} />
            <AccountPill label={`v${APP_BUILD_LABEL}`} onGold={false} />
            <AccountPill label={APP_ABOUT_LINE} onGold={false} />
          </View>
          <Text style={screenStyles.intro}>{t("licenses.engineStandsOn")}</Text>

          {/* Credits and Bundled Packages share a capped list above the source notice. */}
          <View style={settingsStyles.section} onLayout={IS_TV ? undefined : (event) => setListTop(event.nativeEvent.layout.y)}>
            <ScrollView ref={creditsRef} style={[settingsStyles.creditsScrollable, phoneListCap]} showsVerticalScrollIndicator={false} nestedScrollEnabled focusable={false}>
              {credits}
              <ListRow
                title={t("licenses.bundled")}
                subtitle={t("licenses.packagesCount").replace("{count}", String(BUNDLED_PACKAGE_COUNT))}
                trailingIcon="chevron-forward"
                onPress={() => router.push("/bundled-licenses")}
                titleStyle={screenStyles.rowTitle}
                subtitleStyle={screenStyles.rowSubtitle}
                onFocus={pinListToBottom}
                accessibilityRole="link"
                accessibilityLabel={t("licenses.packagesA11y").replace("{count}", String(BUNDLED_PACKAGE_COUNT))}
                accessibilityHint={t("licenses.opensFullList")}
              />
            </ScrollView>
            <View onLayout={IS_TV ? undefined : (event) => setFooterHeight(event.nativeEvent.layout.height)}>
              <SectionFooter>
                <Text style={settingsStyles.sectionNote}>{LGPL_SOURCE_NOTICE}</Text>
              </SectionFooter>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const screenStyles = StyleSheet.create({
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
