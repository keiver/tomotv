import { AmbientBackground } from "@/components/ambient-background";
import { settingsStyles } from "@/components/settings/styles";
import { CREDITS, LGPL3_NOTE, LGPL_SOURCE_NOTICE, LICENSE_TEXTS, type Credit } from "@/constants/licenses";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/**
 * Open-source acknowledgements, pushed from the Help tab. One focusable row
 * per component; selecting a row expands the full license text inline below
 * it. Focusable rows are what make tvOS remote scrolling work inside the
 * ScrollView — the expanded text itself is never focusable, it scrolls past
 * as focus moves between rows. The Menu/back button pops the route natively.
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
          <Text style={screenStyles.intro}>The TomoTV playback engine stands on these projects. Select one to read its license.</Text>

          <View style={settingsStyles.section}>
            {CREDITS.map((credit, index) => {
              const expanded = expandedName === credit.name;
              return (
                <View key={credit.name}>
                  <Pressable
                    style={({ focused }) => [
                      settingsStyles.listItem,
                      index === 0 && settingsStyles.listItemFirst,
                      index === CREDITS.length - 1 && !expanded && settingsStyles.listItemLast,
                      focused && { backgroundColor: "rgba(255, 255, 255, 0.1)" },
                    ]}
                    onPress={() => toggle(credit)}
                    isTVSelectable={true}
                    hasTVPreferredFocus={index === 0}
                    accessibilityRole="button"
                    accessibilityLabel={`${credit.name}, ${credit.licenseLabel}`}
                    accessibilityState={{ expanded }}
                    accessibilityHint={expanded ? "Collapses the license text" : "Expands the license text"}>
                    <View style={settingsStyles.listItemContent}>
                      <View style={settingsStyles.listItemLeft}>
                        <Text style={settingsStyles.listItemTitle}>{credit.name}</Text>
                        <Text style={settingsStyles.listItemSubtitle}>
                          {credit.role} · {credit.licenseLabel}
                        </Text>
                      </View>
                      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={IS_TV ? 26 : 20} color="#98989D" />
                    </View>
                  </Pressable>

                  {expanded && (
                    <View style={screenStyles.licenseBody} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      {credit.copyright ? <Text style={screenStyles.copyright}>{credit.copyright}</Text> : null}
                      {credit.license === "LGPL-3.0" ? <Text style={screenStyles.copyright}>{LGPL3_NOTE}</Text> : null}
                      <Text style={screenStyles.licenseText}>{LICENSE_TEXTS[credit.license]}</Text>
                    </View>
                  )}
                </View>
              );
            })}
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
  copyright: {
    fontSize: IS_TV ? 18 : 12,
    fontWeight: "600",
    color: "#D1D1D6",
    marginBottom: 12,
  },
  licenseText: {
    fontSize: IS_TV ? 16 : 11,
    lineHeight: IS_TV ? 24 : 17,
    color: "#98989D",
    fontVariant: ["tabular-nums"],
  },
  sourceNotice: {
    fontSize: IS_TV ? 16 : 12,
    color: "#8E8E93",
    lineHeight: IS_TV ? 24 : 18,
    marginTop: 24,
    marginHorizontal: IS_TV ? 16 : 8,
  },
});
