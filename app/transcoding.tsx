import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { StreamingQuality } from "@/components/settings/StreamingQuality";
import { settingsStyles, TV_PUSHED_HEADER_TOP } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { serverTranscodingNotice, transcodingLevelHint, transcodingLevelTitle } from "@/components/settings/transcodingCopy";
import { COLORS } from "@/constants/colors";
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
  // The server's own refusal heads the card: whatever is chosen below, it rules.
  const notice = serverTranscodingNotice(permissions);
  const showQuality = serverTranscoding !== "never" && permissions?.video !== false;

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
        {notice ? (
          <SectionFooter edge="top">
            <Text style={[settingsStyles.sectionNote, styles.notice]} accessibilityRole="alert">
              {notice}
            </Text>
          </SectionFooter>
        ) : null}
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
              hasTVPreferredFocus={selected}
              accessibilityState={{ selected }}
              isFirst={index === 0 && !notice}
              isLast={index === SERVER_TRANSCODING_LEVELS.length - 1}
            />
          );
        })}
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
  // The softer red: the one that clears 4.5:1 on the sunken band (ListRow's destructive ink).
  notice: {
    color: COLORS.DESTRUCTIVE_SOFT,
  },
});
