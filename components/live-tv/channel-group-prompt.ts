import { t } from "@/services/i18n";
import { createGroup, renameGroup, toggleChannelInGroup, type ChannelGroup, type ChannelIdentity } from "@/services/liveTvPreferences";
import { Alert } from "react-native";

/** Names a channel group in the system prompt: renames `group` when given, else makes a new one holding `channel`. */
export function promptChannelGroup({ group, channel }: { group?: ChannelGroup; channel?: ChannelIdentity } = {}): void {
  Alert.prompt(
    group ? t("liveTv.renameGroup") : t("liveTv.newGroup"),
    undefined,
    [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.save"),
        onPress: (text?: string) => {
          const name = (text ?? "").trim();
          if (!name) return;
          if (group) return renameGroup(group.id, name);
          const created = createGroup(name);
          if (channel) toggleChannelInGroup(created.id, channel);
        },
      },
    ],
    "plain-text",
    group?.name ?? "",
  );
}
