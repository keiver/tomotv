import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { IS_PAD, settingsStyles, sideInsets } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { COLORS } from "@/constants/colors";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { t } from "@/services/i18n";
import { canManageSubtitles } from "@/services/jellyfinApi";
import { readOwnKey, writeOwnKey, type SubtitleKeyName } from "@/services/subtitles/keys";
import { updateUiPreferences } from "@/services/uiPreferences";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

const KEY_FIELDS: { name: SubtitleKeyName; label: string; secret: boolean }[] = [
  { name: "OPENSUBTITLES_API_KEY", label: "subtitles.opensubtitlesKey", secret: true },
  { name: "OPENSUBTITLES_USERNAME", label: "subtitles.opensubtitlesUser", secret: false },
  { name: "OPENSUBTITLES_PASSWORD", label: "subtitles.opensubtitlesPassword", secret: true },
  { name: "SUBDL_API_KEY", label: "subtitles.subdlKey", secret: true },
  { name: "SUBSOURCE_API_KEY", label: "subtitles.subsourceKey", secret: true },
];

/** One pasted account field: read from the keychain on mount, written back when editing ends. */
function KeyField({ name, label, secret }: { name: SubtitleKeyName; label: string; secret: boolean }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    let mounted = true;
    void readOwnKey(name).then((stored) => mounted && setValue(stored));
    return () => {
      mounted = false;
    };
  }, [name]);
  const commit = useCallback(() => void writeOwnKey(name, value), [name, value]);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{t(label as Parameters<typeof t>[0])}</Text>
      <SunkenTextInput
        value={value}
        onChangeText={setValue}
        onBlur={commit}
        onSubmitEditing={commit}
        secureTextEntry={secret}
        autoCorrect={false}
        autoCapitalize="none"
        placeholder={t("subtitles.keyPlaceholder")}
        placeholderTextColor={COLORS.TEXT_TERTIARY}
        accessibilityLabel={t(label as Parameters<typeof t>[0])}
      />
    </View>
  );
}

/** Where a video's subtitles may come from. A root route: Menu pops it, every press applies at once. */
export default function SubtitleSettingsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { findSubtitles, saveSubtitles } = useUiPreferences();
  const [canSave, setCanSave] = useState(false);
  useEffect(() => {
    let mounted = true;
    void canManageSubtitles().then((allowed) => mounted && setCanSave(allowed));
    return () => {
      mounted = false;
    };
  }, []);
  const toggleFind = useCallback(() => updateUiPreferences({ findSubtitles: !findSubtitles }), [findSubtitles]);
  const toggleSave = useCallback(() => updateUiPreferences({ saveSubtitles: !saveSubtitles }), [saveSubtitles]);

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + (IS_PAD ? 24 : 12), paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }, sideInsets(insets)]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View style={settingsStyles.contentContainer}>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("subtitles.settingsTitle")}</Text>
          </View>
          <View style={settingsStyles.section}>
            <ListRow
              icon="search"
              title={t("subtitles.find")}
              subtitle={t("subtitles.findHint")}
              trailingIcon={findSubtitles ? tick : undefined}
              onPress={toggleFind}
              hasTVPreferredFocus
              isFirst
              isLast={!canSave}
              accessibilityState={{ checked: findSubtitles }}
            />
            {canSave && (
              <ListRow
                icon="cloud-upload-outline"
                title={t("subtitles.save")}
                trailingIcon={saveSubtitles ? tick : undefined}
                onPress={toggleSave}
                isLast
                accessibilityState={{ checked: saveSubtitles }}
              />
            )}
          </View>

          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("subtitles.ownKeys")}</Text>
          </View>
          <View style={[settingsStyles.section, styles.keys]}>
            {KEY_FIELDS.map((field) => (
              <KeyField key={field.name} {...field} />
            ))}
            <Text style={styles.hint}>{t("subtitles.keysHint")}</Text>
          </View>
        </View>
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
  keys: {
    padding: IS_TV ? 28 : 16,
    gap: IS_TV ? 20 : 12,
  },
  field: {
    gap: IS_TV ? 8 : 4,
  },
  fieldLabel: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 20 : 13,
    fontWeight: "600",
  },
  hint: {
    color: COLORS.TEXT_TERTIARY,
    fontSize: IS_TV ? 20 : 13,
    marginTop: IS_TV ? 8 : 4,
  },
});
