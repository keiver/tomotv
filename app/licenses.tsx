import { AmbientBackground } from "@/components/ambient-background";
import { settingsStyles } from "@/components/settings/styles";
import { BUNDLED_PACKAGES, BUNDLED_PACKAGES_DECLARED_ONLY } from "@/constants/bundled-licenses";
import { CARD_FOCUS } from "@/constants/app";
import { CREDITS, LGPL3_NOTE, LGPL_SOURCE_NOTICE, LICENSE_TEXTS, type Credit } from "@/constants/licenses";
import { licenseParagraphs } from "@/utils/licenseParagraphs";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
  const [expandedName, setExpandedName] = useState<string | null>(null);

  const toggle = useCallback((credit: Credit) => {
    setExpandedName((prev) => (prev === credit.name ? null : credit.name));
  }, []);

  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />
      <ScrollView
        style={settingsStyles.scrollView}
        contentContainerStyle={[settingsStyles.scrollContent, { paddingTop: (IS_TV ? 40 : 12) + insets.top, paddingBottom: 60 + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          {/* Phone: pushed routes have no native header, so give touch users a way back.
              TV needs none — the Menu button pops natively. */}
          {!IS_TV && (
            <Pressable onPress={() => router.back()} style={screenStyles.backRow} accessibilityRole="button" accessibilityLabel="Back to Help">
              <Ionicons name="chevron-back" size={22} color="#FFC312" />
              <Text style={screenStyles.backText}>Help</Text>
            </Pressable>
          )}

          <Text style={screenStyles.title}>Open Source</Text>
          <Text style={screenStyles.intro}>The Tomo TV playback engine stands on these projects. Select one to read its license.</Text>

          <View style={settingsStyles.section}>
            {CREDITS.map((credit, index) => {
              const expanded = expandedName === credit.name;
              return (
                <View key={credit.name}>
                  <Pressable
                    style={({ focused, pressed }) => [
                      settingsStyles.listItem,
                      index === 0 && settingsStyles.listItemFirst,
                      index === CREDITS.length - 1 && !expanded && settingsStyles.listItemLast,
                      (focused || pressed) && settingsStyles.listItemFocused,
                    ]}
                    onPress={() => toggle(credit)}
                    isTVSelectable={true}
                    hasTVPreferredFocus={index === 0}
                    accessibilityRole="button"
                    accessibilityLabel={`${credit.name}, ${credit.licenseLabel}`}
                    accessibilityState={{ expanded }}
                    accessibilityHint={expanded ? "Collapses the license text" : "Expands the license text"}>
                    {({ focused, pressed }) => (
                      <View style={settingsStyles.listItemContent}>
                        <View style={settingsStyles.listItemLeft}>
                          <Text style={[settingsStyles.listItemTitle, (focused || pressed) && settingsStyles.listItemTitleFocused]}>{credit.name}</Text>
                          <Text style={[settingsStyles.listItemSubtitle, (focused || pressed) && settingsStyles.listItemSubtitleFocused]}>
                            {credit.role} · {credit.licenseLabel}
                          </Text>
                        </View>
                        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={IS_TV ? 26 : 20} color={focused || pressed ? CARD_FOCUS.TITLE_TEXT_FOCUSED : "#98989D"} />
                      </View>
                    )}
                  </Pressable>

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
            <Pressable
              style={({ focused, pressed }) => [settingsStyles.listItem, settingsStyles.listItemFirst, settingsStyles.listItemLast, (focused || pressed) && settingsStyles.listItemFocused]}
              onPress={() => router.push("/bundled-licenses")}
              isTVSelectable={true}
              accessibilityRole="link"
              accessibilityLabel={`Bundled packages, ${BUNDLED_PACKAGE_COUNT} open source packages, full license text`}
              accessibilityHint="Opens the full third-party license list">
              {({ focused, pressed }) => (
                <View style={settingsStyles.listItemContent}>
                  <View style={settingsStyles.listItemLeft}>
                    <Text style={[settingsStyles.listItemTitle, (focused || pressed) && settingsStyles.listItemTitleFocused]}>Bundled Packages</Text>
                    <Text style={[settingsStyles.listItemSubtitle, (focused || pressed) && settingsStyles.listItemSubtitleFocused]}>
                      {BUNDLED_PACKAGE_COUNT} open-source packages · full license text
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={IS_TV ? 26 : 20} color={focused || pressed ? CARD_FOCUS.TITLE_TEXT_FOCUSED : "#98989D"} />
                </View>
              )}
            </Pressable>
          </View>

          <Text style={screenStyles.sourceNotice}>{LGPL_SOURCE_NOTICE}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const screenStyles = StyleSheet.create({
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    alignSelf: "flex-start",
    paddingVertical: 8,
    marginBottom: 8,
  },
  backText: {
    color: "#FFC312",
    fontSize: 17,
    fontWeight: "600",
  },
  title: {
    fontSize: IS_TV ? 44 : 28,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -1,
    marginBottom: IS_TV ? 10 : 6,
    marginLeft: IS_TV ? 16 : 8,
  },
  intro: {
    fontSize: IS_TV ? 22 : 14,
    color: "#98989D",
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
    color: "#D1D1D6",
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
    color: "#98989D",
    fontVariant: ["tabular-nums"],
  },
  licenseTextFocused: {
    color: "#E5E5EA",
  },
  sourceNotice: {
    fontSize: IS_TV ? 16 : 12,
    color: "#8E8E93",
    lineHeight: IS_TV ? 24 : 18,
    marginTop: 24,
    marginHorizontal: IS_TV ? 16 : 8,
  },
});
