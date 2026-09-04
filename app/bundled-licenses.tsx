import { AmbientBackground } from "@/components/ambient-background";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { BUNDLED_LICENSE_BODIES, BUNDLED_PACKAGES, BUNDLED_PACKAGES_DECLARED_ONLY } from "@/constants/bundled-licenses";
import { COLORS } from "@/constants/colors";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useMemo } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { licenseParagraphs } from "@/utils/licenseParagraphs";

const IS_TV = Platform.isTV;

/**
 * A block of the notice. On TV it is a focus stop, which is the only way the
 * remote can walk text: the focus engine skips non-focusable views, so a plain
 * <Text> here would leave the whole screen unreachable. On phone it is text.
 */
function ReadableBlock({ children, textStyle }: { children: React.ReactNode; textStyle: StyleProp<TextStyle> }) {
  if (!IS_TV) return <Text style={[styles.block, textStyle]}>{children}</Text>;
  return (
    // Role "text", not the default: it is focusable so the remote can reach it, but it does
    // nothing when selected, and VoiceOver announcing a button here promises an action.
    <Pressable isTVSelectable={true} accessibilityRole="text" style={({ focused }) => [styles.block, styles.blockTV, focused && styles.blockFocused]}>
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
 * ~280 KB across 600-odd packages. Laid out like Diagnostics: the page never
 * scrolls, one card takes the height under the title, and a FlatList scrolls
 * inside it so only the groups on screen are mounted.
 */
export default function BundledLicensesScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

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
      <View style={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}>
        <View style={[settingsStyles.contentContainer, styles.column]}>
          {/* Phone puts this in the native bar; TV has no header. */}
          {IS_TV && <Text style={styles.title}>Bundled Packages</Text>}
          <View style={[settingsStyles.section, styles.card]}>
            <FlatList
              style={styles.list}
              data={sections}
              keyExtractor={(section) => section.key}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={!IS_TV}
              initialNumToRender={2}
              maxToRenderPerBatch={2}
              windowSize={3}
              removeClippedSubviews={!IS_TV}
              ItemSeparatorComponent={Divider}
              renderItem={({ item }) => (
                <View style={styles.group}>
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
              )}
              ListFooterComponent={
                declaredOnly.length > 0 ? (
                  <>
                    <Divider />
                    <View style={styles.group}>
                      <ReadableBlock textStyle={styles.packagesLabel}>Declared without a license file</ReadableBlock>
                      <ReadableBlock textStyle={styles.note}>
                        These packages state their license in their manifest but ship no license file of their own, so no copyright line is reproduced for them.
                      </ReadableBlock>
                      <ReadableBlock textStyle={styles.packages}>{declaredOnly}</ReadableBlock>
                    </View>
                  </>
                ) : null
              }
            />
            <SectionFooter>
              <Text style={settingsStyles.sectionNote}>
                {BUNDLED_PACKAGES.length + BUNDLED_PACKAGES_DECLARED_ONLY.length} open-source packages ship inside Tomo TV. Their licenses are reproduced above, grouped by the text they share.
              </Text>
            </SectionFooter>
          </View>
        </View>
      </View>
    </View>
  );
}

const Divider = () => <View style={settingsStyles.listDivider} />;

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: "center" },
  column: { flex: 1 },
  title: {
    fontSize: 44,
    fontWeight: "800",
    color: COLORS.TEXT_PRIMARY,
    letterSpacing: -1,
    marginBottom: 24,
    marginHorizontal: 16,
  },
  // flex: 1 is the whole point: the card eats the height the title did not, and its overflow
  // clip cuts the 70-odd `=` rulers some texts draw, which CoreText never breaks.
  card: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingVertical: IS_TV ? 20 : 14 },
  group: { paddingVertical: IS_TV ? 8 : 4 },
  note: {
    fontSize: IS_TV ? 22 : 14,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: IS_TV ? 30 : 20,
    marginBottom: IS_TV ? 12 : 8,
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
  // Text sits on a row's edge, and the TV focus wash fills the card wall to wall like a row.
  block: {
    paddingHorizontal: settingsStyles.listItem.paddingHorizontal,
  },
  blockTV: {
    paddingVertical: 6,
  },
  blockFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  blockTextFocused: {
    color: COLORS.TEXT_BRIGHT,
  },
});
