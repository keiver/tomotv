import { settingsStyles } from "@/components/settings/styles";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import React, { useState } from "react";
import { Platform, StyleSheet } from "react-native";

interface SubtitleSearchFieldProps {
  value: string;
  onSubmit: (keywords: string) => void;
}

/** The words a job searches by, prefilled from the file and edited only to correct it. */
export function SubtitleSearchField({ value, onSubmit }: SubtitleSearchFieldProps) {
  const [edit, setEdit] = useState<{ from: string; draft: string }>({ from: value, draft: value });
  // A new value from the job replaces a draft started from the old one; derived in render.
  if (edit.from !== value) setEdit({ from: value, draft: value });
  const draft = edit.from === value ? edit.draft : value;
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSubmit(trimmed);
  };
  return (
    <SunkenTextInput
      value={draft}
      onChangeText={(text) => setEdit({ from: value, draft: text })}
      onSubmitEditing={commit}
      onBlur={commit}
      placeholder={t("subtitles.searchPlaceholder")}
      placeholderTextColor={COLORS.TEXT_TERTIARY}
      returnKeyType="search"
      autoCorrect={false}
      autoCapitalize="none"
      accessibilityLabel={t("subtitles.search")}
      style={settingsStyles.textInput}
      containerStyle={styles.field}
    />
  );
}

const styles = StyleSheet.create({
  field: {
    marginTop: Platform.isTV ? 20 : 12,
  },
});
