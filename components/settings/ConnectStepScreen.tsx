import { AmbientBackground } from "@/components/ambient-background";
import { TopScrim } from "@/components/top-scrim";
import { settingsStyles as styles } from "@/components/settings/styles";
import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";

interface ConnectStepScreenProps {
  /** Phone screen title, when the step stands in for a tab that has one. */
  title?: string;
  /** The grouped-list section header above the content. */
  header: string;
  /**
   * Centre the content in the viewport instead of hanging it from the top. The
   * pushed login steps cover the tabs, so with no tab bar and no screen title above
   * it, top-aligned content leaves a band of dead screen underneath. The tab-hosted
   * server list leaves this off and stays aligned with its neighbours' titles.
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

  return (
    <View style={styles.screenContainer}>
      <AmbientBackground />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, centered && ownStyles.centered]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        focusable={false}>
        <View style={styles.contentContainer}>
          {showTitle && <Text style={styles.screenTitle}>{title}</Text>}

          <View style={[styles.sectionHeader, showTitle && styles.sectionHeaderFirst]}>
            <Text style={styles.sectionHeaderText}>{header}</Text>
          </View>

          {children}
        </View>
      </ScrollView>
      {/* Tab-hosted only. `centered` marks the pushed login steps, which cover
          the tabs — with no bar up there, there is nothing to fade content
          under. TV only: phone's tabs sit at the bottom. */}
      {Platform.isTV && !centered && <TopScrim />}
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
