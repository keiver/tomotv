import { AmbientBackground } from "@/components/ambient-background";
import { ServerConnectFlow } from "@/components/settings/ServerConnectFlow";
import { settingsStyles as styles } from "@/components/settings/styles";
import React from "react";
import { Platform, ScrollView, Text, View } from "react-native";

interface ServerConnectScreenProps {
  /** Phone tab title (e.g. "Libraries", "Search") so the tab keeps its header while logged out. */
  title?: string;
}

/**
 * Full-screen host for the connect widget — the exact JELLYFIN SERVER view the Settings tab
 * shows when no server is connected. The Library and Search tabs render this in place of their
 * old error CTA while logged out; no onConnected needed, since their auth gates flip on login
 * and AuthContext routes to the Library root.
 */
export function ServerConnectScreen({ title }: ServerConnectScreenProps) {
  const showTitle = !Platform.isTV && !!title;
  return (
    <View style={styles.screenContainer}>
      <AmbientBackground />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        focusable={false}>
        <View style={styles.contentContainer}>
          {showTitle && <Text style={styles.screenTitle}>{title}</Text>}

          <View style={[styles.sectionHeader, showTitle && styles.sectionHeaderFirst]}>
            <Text style={styles.sectionHeaderText}>JELLYFIN SERVER</Text>
          </View>

          <ServerConnectFlow />
        </View>
      </ScrollView>
    </View>
  );
}
