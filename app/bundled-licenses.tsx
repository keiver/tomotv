import { AmbientBackground } from "@/components/ambient-background";
import { settingsStyles } from "@/components/settings/styles";
import { BUNDLED_LICENSE_BODIES, BUNDLED_PACKAGES, BUNDLED_PACKAGES_DECLARED_ONLY } from "@/constants/bundled-licenses";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type TextStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { licenseParagraphs } from "@/utils/licenseParagraphs";

const IS_TV = Platform.isTV;

/**
 * A block of the notice. On TV it is a focus stop, which is the only way the
 * remote can walk text: the focus engine skips non-focusable views, so a plain
 * <Text> here would leave the whole screen unreachable. On phone it is text.
 */
function ReadableBlock({ children, textStyle }: { children: React.ReactNode; textStyle: StyleProp<TextStyle> }) {
  if (!IS_TV) return <Text style={textStyle}>{children}</Text>;
  return (
    // Role "text", not the default: it is focusable so the remote can reach it, but it does
    // nothing when selected, and VoiceOver announcing a button here promises an action.
    <Pressable isTVSelectable={true} accessibilityRole="text" style={({ focused }) => [styles.block, focused && styles.blockFocused]}>
      {({ focused }) => <Text style={[textStyle, focused && styles.blockTextFocused]}>{children}</Text>}
    </Pressable>
  );
}

interface NoticeSection {
  key: string;
  /** Every package that ships this exact license text. */
  packages: string[];
  /** Deduplicated copyright lines, in the order first seen. */
  copyright: string[];
  text: string;
}

/**
 * The complete third-party notice for the npm tree, grouped by license text.
 *
 * A separate route from Open Source rather than an expanding row: the notice is
 * ~280 KB across 600-odd packages, and the acknowledgements screen renders its
 * expansions inline. A FlatList keeps that off the first frame and off the TV
 * focus engine, which walks live cells.
 *
 * Grouping is what makes it readable AND smaller: MIT is one grant repeated
 * hundreds of times, so the text is shown once per distinct wording with every
 * package and copyright line that shares it. Nothing is summarised away.
 */
export default function BundledLicensesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Every block below is sized in points, not with contentContainer's `width: "100%"`. A
  // FlatList wraps its header and each cell in an unstyled View that shrink-wraps its content
  // (scrollContent centres rather than stretches), so the percentage has no definite parent to
  // resolve against and falls through to maxWidth — 600pt of page on a 393pt phone.
  const { width } = useWindowDimensions();

  const sections = useMemo<NoticeSection[]>(() => {
    const byBody = new Map<string, NoticeSection>();
    for (const pkg of BUNDLED_PACKAGES) {
      let section = byBody.get(pkg.body);
      if (!section) {
        section = { key: pkg.body, packages: [], copyright: [], text: BUNDLED_LICENSE_BODIES[pkg.body] ?? "" };
        byBody.set(pkg.body, section);
      }
      section.packages.push(`${pkg.name} ${pkg.version}`);
      for (const line of pkg.copyright) if (!section.copyright.includes(line)) section.copyright.push(line);
    }
    return [...byBody.values()].sort((a, b) => b.packages.length - a.packages.length);
  }, []);

  const declaredOnly = useMemo(() => BUNDLED_PACKAGES_DECLARED_ONLY.map((pkg) => `${pkg.name} ${pkg.version} — ${pkg.license}`).join("\n"), []);

  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />
      <FlatList
        data={sections}
        keyExtractor={(section) => section.key}
        contentContainerStyle={[settingsStyles.scrollContent, { paddingTop: (IS_TV ? 40 : 12) + insets.top, paddingBottom: 60 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews={!IS_TV}
        ListHeaderComponent={
          <View style={[settingsStyles.contentContainer, { width }]}>
            {!IS_TV && (
              <Pressable onPress={() => router.back()} style={styles.backRow} accessibilityRole="button" accessibilityLabel="Back to Open Source">
                <Ionicons name="chevron-back" size={22} color={COLORS.ACCENT} />
                <Text style={styles.backText}>Open Source</Text>
              </Pressable>
            )}
            <Text style={styles.title}>Bundled Packages</Text>
            <Text style={styles.intro}>
              {BUNDLED_PACKAGES.length + BUNDLED_PACKAGES_DECLARED_ONLY.length} open-source packages ship inside Tomo TV. Their licenses are reproduced below, grouped by the text they share.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[settingsStyles.contentContainer, { width }]}>
            <View style={styles.section}>
              {item.copyright.map((line, index) => (
                <ReadableBlock key={`copyright-${index}`} textStyle={styles.copyright}>
                  {line}
                </ReadableBlock>
              ))}
              {licenseParagraphs(item.text).map((paragraph, index) => (
                <ReadableBlock key={`text-${index}`} textStyle={styles.licenseText}>
                  {paragraph}
                </ReadableBlock>
              ))}
              <ReadableBlock textStyle={styles.packagesLabel}>{item.packages.length === 1 ? "Applies to 1 package" : `Applies to ${item.packages.length} packages`}</ReadableBlock>
              <ReadableBlock textStyle={styles.packages}>{item.packages.join(", ")}</ReadableBlock>
            </View>
          </View>
        )}
        ListFooterComponent={
          declaredOnly.length > 0 ? (
            <View style={[settingsStyles.contentContainer, { width }]}>
              <View style={styles.section}>
                <ReadableBlock textStyle={styles.packagesLabel}>Declared without a license file</ReadableBlock>
                <ReadableBlock textStyle={styles.intro}>
                  These packages state their license in their manifest but ship no license file of their own, so no copyright line is reproduced for them.
                </ReadableBlock>
                <ReadableBlock textStyle={styles.packages}>{declaredOnly}</ReadableBlock>
              </View>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    alignSelf: "flex-start",
    paddingVertical: 8,
    marginBottom: 8,
  },
  backText: {
    color: COLORS.ACCENT,
    fontSize: 17,
    fontWeight: "600",
  },
  title: {
    fontSize: IS_TV ? 44 : 28,
    fontWeight: "800",
    color: COLORS.TEXT_PRIMARY,
    letterSpacing: -1,
    marginBottom: IS_TV ? 10 : 6,
    marginLeft: IS_TV ? 16 : 8,
  },
  intro: {
    fontSize: IS_TV ? 22 : 14,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: IS_TV ? 30 : 20,
    marginBottom: IS_TV ? 28 : 18,
    marginLeft: IS_TV ? 16 : 8,
  },
  // Clipped: some texts rule off their headings with 70-odd `=` or `*`, and neither character is
  // a line-break opportunity, so CoreText lays the run out at ~450pt and it escapes the card.
  // Only decoration is ever cut; every real word and URL fits inside the card's width.
  section: {
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    borderRadius: 14,
    overflow: "hidden",
    paddingVertical: IS_TV ? 20 : 14,
    paddingHorizontal: IS_TV ? 24 : 16,
    marginBottom: IS_TV ? 20 : 14,
  },
  copyright: {
    fontSize: IS_TV ? 22 : 12,
    fontWeight: "600",
    color: COLORS.TEXT_BODY,
    marginBottom: 8,
  },
  licenseText: {
    fontSize: IS_TV ? 22 : 11,
    lineHeight: IS_TV ? 32 : 17,
    color: COLORS.TEXT_SECONDARY,
  },
  packagesLabel: {
    fontSize: IS_TV ? 20 : 12,
    fontWeight: "600",
    color: COLORS.TEXT_BODY,
    marginTop: 16,
    marginBottom: 6,
  },
  packages: {
    fontSize: IS_TV ? 18 : 11,
    lineHeight: IS_TV ? 26 : 16,
    color: COLORS.TEXT_TERTIARY,
  },
  block: {
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginHorizontal: -12,
  },
  blockFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  blockTextFocused: {
    color: COLORS.TEXT_BRIGHT,
  },
});
