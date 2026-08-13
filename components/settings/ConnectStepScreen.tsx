import { AmbientBackground } from "@/components/ambient-background";
import { BrandCorners } from "@/components/brand-corners";
import { settingsStyles as styles } from "@/components/settings/styles";
import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";

interface ConnectStepScreenProps {
  /** Phone screen title, when the step stands in for a tab that has one. */
  title?: string;
  /** The grouped-list section header above the content. */
  header: string;
  /**
   * Centre the content in the viewport instead of hanging it from the top.
   *
   * Honoured on TV ONLY, whatever the caller passes. A television has room to spare
   * around a password field or a six-character code, and centring reads as
   * deliberate there: the steps cover the tabs, so top-aligned content would leave a
   * band of dead screen underneath. A phone is the opposite case. The same treatment
   * floats the form down the middle of a tall screen, out of line with every other
   * screen in the app, and the keyboard then shoves it around. Phones hang these
   * steps from the top, like the server list they were pushed from.
   *
   * The tab-hosted server list passes nothing and stays top-aligned on both.
   */
  centered?: boolean;
  children: React.ReactNode;
}

/**
 * Full-screen chrome shared by every step of the connect flow: the ambient wash,
 * the scroll container, the content width cap and the section header. Holding it
 * in one place is what keeps a pushed login step looking like the server list it
 * came from, rather than like a different screen.
 */
export function ConnectStepScreen({ title, header, centered = false, children }: ConnectStepScreenProps) {
  const showTitle = !Platform.isTV && !!title;
  // See the `centered` prop: the request only applies on TV.
  const centerContent = centered && Platform.isTV;

  return (
    <View style={styles.screenContainer}>
      <AmbientBackground />
      {/* Sits here rather than in ServerConnectScreen so it carries through the pushed
          login steps too — which is this component's whole reason for existing, and it
          means the setup QR is on screen exactly when someone is stuck connecting.
          Before the ScrollView: on tvOS a view above a focusable occludes it. */}
      <BrandCorners />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, centerContent && ownStyles.centered]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        focusable={false}>
        <View style={styles.contentContainer}>
          {showTitle && <Text style={styles.screenTitle}>{title}</Text>}

          {/* Keyed to what the layout actually does, not to what the caller asked for. A centred
              step needs no top margin: it already floats mid-screen, where the margin would just
              shift the block up by half of itself. Anything top-aligned gets the air, which is
              how a phone's pushed step ends up sitting exactly where the server list it came
              from sits — the point of this component. */}
          <View style={[styles.sectionHeader, showTitle && styles.sectionHeaderFirst, !centerContent && styles.connectHeaderSpacing]}>
            {/* One line, truncated: the login steps put the server's own name in here,
                and a long one would otherwise wrap the header into a paragraph. */}
            <Text style={styles.sectionHeaderText} numberOfLines={1}>
              {header}
            </Text>
          </View>

          {children}
        </View>
      </ScrollView>
    </View>
  );
}

const ownStyles = StyleSheet.create({
  // flexGrow, not flex: the content still scrolls normally once it outgrows the
  // viewport (a raised keyboard, or the longest server name), and only centres
  // while there is room to spare.
  centered: {
    flexGrow: 1,
    justifyContent: "center",
    paddingTop: 0,
  },
});
