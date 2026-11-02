import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { SectionListCard, type RowGroup, type RowPlace } from "@/components/settings/SectionListCard";
import { IS_PAD, settingsStyles, sideInsets } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { COLORS } from "@/constants/colors";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { t } from "@/services/i18n";
import { canManageSubtitles } from "@/services/jellyfinApi";
import { sourceName } from "@/services/subtitles/jobText";
import { readOwnKey, writeOwnKey, type SubtitleKeyName } from "@/services/subtitles/keys";
import type { SubtitleSourceId } from "@/services/subtitles/types";
import { updateUiPreferences } from "@/services/uiPreferences";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

interface KeyFieldSpec {
  name: SubtitleKeyName;
  label: string;
  secret: boolean;
}

/** A row of the card: a switch, or one service's field(s) sharing the line. */
type SettingsRow = { kind: "find" } | { kind: "save" } | { kind: "fields"; source: SubtitleSourceId; fields: KeyFieldSpec[] };

const SERVICES: { source: SubtitleSourceId; url: string; rows: KeyFieldSpec[][] }[] = [
  {
    source: "opensubtitles",
    url: "opensubtitles.com",
    rows: [
      [
        { name: "OPENSUBTITLES_USERNAME", label: "subtitles.username", secret: false },
        { name: "OPENSUBTITLES_PASSWORD", label: "subtitles.password", secret: true },
      ],
    ],
  },
];

const rowKey = (row: SettingsRow) => (row.kind === "fields" ? `${row.source}/${row.fields[0].name}` : row.kind);

interface KeyFieldProps extends KeyFieldSpec {
  source: SubtitleSourceId;
  onFocus?: () => void;
  onBlur?: () => void;
}

/** One pasted account field: read from the keychain on mount, written back when editing ends. */
function KeyField({ name, label, secret, source, onFocus, onBlur }: KeyFieldProps) {
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
      <SunkenTextInput
        value={value}
        onChangeText={setValue}
        onFocus={onFocus}
        onBlur={() => {
          commit();
          onBlur?.();
        }}
        onSubmitEditing={commit}
        secureTextEntry={secret}
        autoCorrect={false}
        autoCapitalize="none"
        placeholder={t(label as Parameters<typeof t>[0])}
        placeholderTextColor={COLORS.TEXT_TERTIARY}
        accessibilityLabel={`${sourceName(source)} ${t(label as Parameters<typeof t>[0])}`}
        style={settingsStyles.textInput}
      />
    </View>
  );
}

/**
 * Where a video's subtitles may come from, as one grouped card fitted to the screen: the two
 * switches on top, each account's fields under its service's url, the keychain line as the
 * card's foot. A root route: Menu pops it, every press applies at once.
 */
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

  const groups: RowGroup<SettingsRow>[] = [
    { data: [{ kind: "find" }, ...(canSave ? [{ kind: "save" } as const] : [])] },
    ...SERVICES.map((service) => ({
      title: service.url,
      data: service.rows.map((fields): SettingsRow => ({ kind: "fields", source: service.source, fields })),
    })),
  ];

  const renderRow = (row: SettingsRow, place: RowPlace) => {
    if (row.kind === "find") {
      return (
        <ListRow
          icon="search"
          title={t("subtitles.find")}
          subtitle={t("subtitles.findHint")}
          trailingIcon={findSubtitles ? tick : undefined}
          onPress={toggleFind}
          onFocus={place.onFocus}
          onBlur={place.onBlur}
          hasTVPreferredFocus
          isFirst={place.isFirst}
          isLast={place.isLast}
          moreBelow={place.moreBelow}
          accessibilityState={{ checked: findSubtitles }}
        />
      );
    }
    if (row.kind === "save") {
      return (
        <ListRow
          icon="cloud-upload-outline"
          title={t("subtitles.save")}
          trailingIcon={saveSubtitles ? tick : undefined}
          onPress={toggleSave}
          onFocus={place.onFocus}
          onBlur={place.onBlur}
          isFirst={place.isFirst}
          isLast={place.isLast}
          moreBelow={place.moreBelow}
          accessibilityState={{ checked: saveSubtitles }}
        />
      );
    }
    return (
      <View style={styles.fieldRow}>
        {row.fields.map((field) => (
          <KeyField key={field.name} {...field} source={row.source} onFocus={place.onFocus} onBlur={place.onBlur} />
        ))}
      </View>
    );
  };

  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />
      <View style={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + (IS_PAD ? 24 : 12), paddingBottom: insets.bottom }, sideInsets(insets)]}>
        <View style={[settingsStyles.contentContainer, styles.content]}>
          <View style={[settingsStyles.sectionHeader, settingsStyles.sectionHeaderFirst]}>
            <Text style={settingsStyles.sectionHeaderText}>{t("subtitles.sources")}</Text>
          </View>
          <SectionListCard
            groups={groups}
            keyExtractor={rowKey}
            renderRow={renderRow}
            style={styles.card}
            footer={
              <SectionFooter>
                <Text style={settingsStyles.sectionNote}>{t("subtitles.keysHint")}</Text>
              </SectionFooter>
            }
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: "center",
  },
  content: {
    flex: 1,
  },
  card: {
    flexShrink: 1,
  },
  fieldRow: {
    flexDirection: "row",
    gap: IS_TV ? 20 : 12,
    paddingHorizontal: IS_TV ? 32 : 20,
    paddingVertical: IS_TV ? 12 : 8,
  },
  field: {
    flex: 1,
  },
});
