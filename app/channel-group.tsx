import { AmbientBackground } from "@/components/ambient-background";
import { GlassButton } from "@/components/glass-button";
import { settingsStyles } from "@/components/settings/styles";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { t } from "@/services/i18n";
import { createGroup, getLiveTvPreferences, renameGroup, toggleChannelInGroup } from "@/services/liveTvPreferences";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** Names a channel group: a new one (holding the channel it was made for, when given) or an existing one. Menu pops it. */
export default function ChannelGroupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const params = useLocalSearchParams<{ groupId?: string; channelName?: string; channelNumber?: string }>();
  const existing = params.groupId ? getLiveTvPreferences().groups.find((group) => group.id === params.groupId) : undefined;
  const [name, setName] = useState(existing?.name ?? "");

  const save = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existing) {
      renameGroup(existing.id, trimmed);
    } else {
      const group = createGroup(trimmed);
      if (params.channelName) toggleChannelInGroup(group.id, { Name: params.channelName, ChannelNumber: params.channelNumber });
    }
    router.back();
  }, [name, existing, params.channelName, params.channelNumber, router]);

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <View style={[styles.page, { paddingTop: IS_TV ? 80 + insets.top : headerHeight + 24 }]}>
        <View style={[settingsStyles.contentContainer, styles.column]}>
          <SunkenTextInput value={name} onChangeText={setName} onSubmitEditing={save} placeholder={t("liveTv.groupName")} autoFocus returnKeyType="done" autoCorrect={false} />
          <GlassButton title={t("common.save")} onPress={save} />
        </View>
      </View>
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
  column: {
    gap: IS_TV ? 32 : 16,
    alignItems: "center",
  },
});
