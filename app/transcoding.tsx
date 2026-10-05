import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { ServerTranscodingFooter } from "@/components/settings/ServerTranscodingFooter";
import { StreamingQuality } from "@/components/settings/StreamingQuality";
import { settingsStyles, TV_PUSHED_HEADER_TOP } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { transcodingLevelHint, transcodingLevelTitle } from "@/components/settings/transcodingCopy";
import { useTranscodePermissions } from "@/hooks/useTranscodePermissions";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { t } from "@/services/i18n";
import { refreshTranscodePermissions } from "@/services/jellyfin/transcodePermissions";
import { SERVER_TRANSCODING_LEVELS, updateUiPreferences, type ServerTranscoding } from "@/services/uiPreferences";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** When the server may transcode, followed by its output quality while video transcoding is allowed. */
export default function TranscodingScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [viewportHeight, setViewportHeight] = useState(0);
  const [qualityTop, setQualityTop] = useState(0);
  const { serverTranscoding } = useUiPreferences();
  const permissions = useTranscodePermissions();
  // The server's own setting closes the section: whatever is chosen above it, it rules.
  const serverOff = permissions?.video === false;
  const showQuality = serverTranscoding !== "never" && !serverOff;

  useEffect(() => {
    void refreshTranscodePermissions();
  }, []);

  const pick = (level: ServerTranscoding) => updateUiPreferences({ serverTranscoding: level });

  const pagePadding = { paddingTop: IS_TV ? TV_PUSHED_HEADER_TOP + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom };

  const content = (
    <View style={settingsStyles.contentContainer}>
      <View style={settingsStyles.sectionHeader}>
        <Text style={settingsStyles.sectionHeaderText}>{t("settings.transcoding.header")}</Text>
      </View>
      <View style={settingsStyles.section}>
        {SERVER_TRANSCODING_LEVELS.map((level, index) => {
          const selected = serverTranscoding === level;
          return (
            <ListRow
              key={level}
              title={transcodingLevelTitle(level)}
              subtitle={transcodingLevelHint(level)}
              subtitleLines={0}
              trailingIcon={selected ? tick : undefined}
              onPress={() => pick(level)}
              // The server has the last word: its refusal leaves nothing here to choose.
              disabled={serverOff}
              hasTVPreferredFocus={selected && !serverOff}
              accessibilityState={{ selected, disabled: serverOff }}
              isFirst={index === 0}
              // The footer closes the card once the server is read; the last row stays square above it.
              isLast={index === SERVER_TRANSCODING_LEVELS.length - 1 && !permissions}
            />
          );
        })}
        <ServerTranscodingFooter permissions={permissions} />
      </View>
      {showQuality ? (
        <View onLayout={IS_TV ? (event) => setQualityTop(event.nativeEvent.layout.y) : undefined}>
          <StreamingQuality availableHeight={IS_TV ? Math.max(0, viewportHeight - pagePadding.paddingTop - pagePadding.paddingBottom - qualityTop) : undefined} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={[styles.page, pagePadding]}
        onLayout={IS_TV ? (event) => setViewportHeight(event.nativeEvent.layout.height) : undefined}
        showsVerticalScrollIndicator={false}
        focusable={false}>
        {content}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  page: {
    alignItems: "center",
  },
});
