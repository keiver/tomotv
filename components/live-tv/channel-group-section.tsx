import { ListRow } from "@/components/settings/ListRow";
import { RollingFieldRow } from "@/components/settings/RollingFieldRow";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { toggleFavoriteChannel } from "@/services/channelFavorites";
import { t } from "@/services/i18n";
import { createGroup, isChannelInGroup, isFavoriteChannel, toggleChannelInGroup, type ChannelIdentity } from "@/services/liveTvPreferences";
import React, { useCallback, useState } from "react";
import { View } from "react-native";

interface ChannelGroupSectionProps {
  channel: ChannelIdentity;
}

/**
 * The channel's favorite and group membership as a sunken list: a row press adds or removes it and
 * the tick redraws in place. The last row rolls into a field that names a new group holding the channel.
 */
export function ChannelGroupSection({ channel }: ChannelGroupSectionProps) {
  const preferences = useLiveTvPreferences();
  const { groups } = preferences;
  const favorite = isFavoriteChannel(preferences, channel);
  const [name, setName] = useState("");

  const saveNewGroup = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed) toggleChannelInGroup(createGroup(trimmed).id, channel);
    setName("");
  }, [name, channel]);

  return (
    <View style={settingsStyles.section}>
      <ListRow
        icon={favorite ? "heart" : "heart-outline"}
        title={t("library.favorites")}
        trailingIcon={favorite ? tick : undefined}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: favorite }}
        onPress={() => toggleFavoriteChannel(channel)}
        hasTVPreferredFocus
        isFirst
      />
      {groups.map((group) => {
        const member = isChannelInGroup(group, channel);
        return (
          <ListRow
            key={group.id}
            icon="albums-outline"
            title={group.name}
            trailingIcon={member ? tick : undefined}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: member }}
            onPress={() => toggleChannelInGroup(group.id, channel)}
          />
        );
      })}
      <RollingFieldRow icon="add" title={t("liveTv.newGroup")} placeholder={t("liveTv.groupName")} value={name} onChangeText={setName} onSave={saveNewGroup} />
    </View>
  );
}
