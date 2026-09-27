import { ListRow } from "@/components/settings/ListRow";
import { RollingFieldRow } from "@/components/settings/RollingFieldRow";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { t } from "@/services/i18n";
import { createGroup, isChannelInGroup, toggleChannelInGroup, type ChannelIdentity } from "@/services/liveTvPreferences";
import React, { useCallback, useState } from "react";
import { View } from "react-native";

interface ChannelGroupSectionProps {
  channel: ChannelIdentity;
}

/**
 * The channel's group membership as a sunken list: a row press adds or removes it and the tick
 * redraws in place. The last row rolls into a field that names a new group holding the channel.
 */
export function ChannelGroupSection({ channel }: ChannelGroupSectionProps) {
  const { groups } = useLiveTvPreferences();
  const [name, setName] = useState("");

  const saveNewGroup = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed) toggleChannelInGroup(createGroup(trimmed).id, channel);
    setName("");
  }, [name, channel]);

  return (
    <View style={settingsStyles.section}>
      {groups.map((group, index) => {
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
            isFirst={index === 0}
          />
        );
      })}
      <RollingFieldRow icon="add" title={t("liveTv.newGroup")} placeholder={t("liveTv.groupName")} isFirst={groups.length === 0} value={name} onChangeText={setName} onSave={saveNewGroup} />
    </View>
  );
}
