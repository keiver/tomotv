import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { APP_ABOUT_LINE } from "@/constants/app";
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
          <Text style={screenStyles.version}>{APP_ABOUT_LINE}</Text>
          <Text style={screenStyles.intro}>The playback engine stands on these projects. Select one to read its license.</Text>

          <View style={settingsStyles.section}>
            {CREDITS.map((credit, index) => {
              const expanded = expandedName === credit.name;
              return (
                <View key={credit.name}>
                  <ListRow
                    title={credit.name}
                    subtitle={`${credit.role} · ${credit.licenseLabel}`}
                    trailingIcon={expanded ? "chevron-up" : "chevron-down"}
                    onPress={() => toggle(credit)}
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
            })}
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
              isLast
              accessibilityRole="link"
              accessibilityLabel={`Bundled packages, ${BUNDLED_PACKAGE_COUNT} open source packages, full license text`}
              accessibilityHint="Opens the full third-party license list"
            />
          </View>

          <Text style={screenStyles.sourceNotice}>{LGPL_SOURCE_NOTICE}</Text>
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
  version: {
    fontSize: IS_TV ? 30 : 20,
    fontWeight: "700",
    color: COLORS.TEXT_PRIMARY,
    marginBottom: IS_TV ? 10 : 6,
    marginLeft: IS_TV ? 16 : 8,
    fontVariant: ["tabular-nums"],
  },
  intro: {
    fontSize: IS_TV ? 22 : 14,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: IS_TV ? 30 : 20,
    marginBottom: IS_TV ? 28 : 18,
    marginLeft: IS_TV ? 16 : 8,
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
  sourceNotice: {
    fontSize: IS_TV ? 16 : 12,
    color: COLORS.TEXT_TERTIARY,
    lineHeight: IS_TV ? 24 : 18,
    marginTop: 24,
    marginHorizontal: IS_TV ? 16 : 8,
  },
});
