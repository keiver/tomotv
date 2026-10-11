import { ListRow } from "@/components/settings/ListRow";
import { RollingFieldRow } from "@/components/settings/RollingFieldRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { COLORS } from "@/constants/colors";
import { useChannelGroupChoices } from "@/hooks/useChannelGroupChoices";
import { t } from "@/services/i18n";
import { createGroup, toggleChannelInGroup, type ChannelIdentity } from "@/services/liveTvPreferences";
import React, { useCallback, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";

const VISIBLE_GROUP_ROWS = 4;

interface ChannelGroupSectionProps {
  channel: ChannelIdentity;
}

/**
 * The channel's favorite and group membership as a sunken list, at most VISIBLE_GROUP_ROWS rows before it scrolls:
 * a row press adds or removes it and the tick redraws in place. The last row rolls into a field that names a new group holding the channel.
 */
export function ChannelGroupSection({ channel }: ChannelGroupSectionProps) {
  const choices = useChannelGroupChoices(channel);
  const [name, setName] = useState("");
  const [listCap, setListCap] = useState<number>();

  const saveNewGroup = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed) toggleChannelInGroup(createGroup(trimmed).id, channel);
    setName("");
  }, [name, channel]);

  const rows = choices.map((choice, index) => {
    const row = (
      <ListRow
        key={choice.key}
        icon={choice.kind === "favorites" ? (choice.member ? "heart" : "heart-outline") : "albums-outline"}
        title={choice.label}
        trailingIcon={choice.member ? tick : undefined}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: choice.member }}
        onPress={choice.toggle}
        hasTVPreferredFocus={index === 0}
        isFirst={index === 0}
      />
    );
    // The cap is measured at the last visible row's bottom edge, as the Themes list does.
    return index === VISIBLE_GROUP_ROWS - 1 && choices.length > VISIBLE_GROUP_ROWS ? (
      <View key={choice.key} onLayout={({ nativeEvent: { layout } }) => setListCap(layout.y + layout.height)}>
        {row}
      </View>
    ) : (
      row
    );
  });

  return (
    <View style={settingsStyles.section}>
      <ScrollView style={{ maxHeight: listCap }} showsVerticalScrollIndicator={false} nestedScrollEnabled focusable={false}>
        {rows}
      </ScrollView>
      {/* The card's sunken footer, as Themes closes its card; on TV its shadow rides the footer, never an overlay over the row. */}
      <SectionFooter focusable={Platform.isTV}>
        <View style={styles.footer}>
          <RollingFieldRow icon="add" title={t("liveTv.newGroup")} placeholder={t("liveTv.groupName")} value={name} onChangeText={setName} onSave={saveNewGroup} />
        </View>
      </SectionFooter>
    </View>
  );
}

const styles = StyleSheet.create({
  // The settings note's sunken band.
  footer: {
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
});
