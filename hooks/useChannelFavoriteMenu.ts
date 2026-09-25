import { t } from "@/services/i18n";
import { getLiveTvPreferences, isChannelInGroup, isFavoriteChannel, toggleChannelInGroup, toggleFavoriteChannel } from "@/services/liveTvPreferences";
import type { JellyfinItem } from "@/types/jellyfin";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";

/** A held channel card: the native sheet toggles the favorite or opens the groups sheet, one press each. */
export function useChannelFavoriteMenu(): (channel: JellyfinItem) => void {
  const router = useRouter();
  const openGroups = useCallback(
    (channel: JellyfinItem) => {
      const { groups } = getLiveTvPreferences();
      Alert.alert(channel.Name, undefined, [
        ...groups.map((group) => ({ text: isChannelInGroup(group, channel) ? `✓ ${group.name}` : group.name, onPress: () => toggleChannelInGroup(group.id, channel) })),
        {
          text: t("liveTv.newGroup"),
          onPress: () => router.push({ pathname: "/channel-group", params: { channelName: channel.Name, ...(channel.ChannelNumber ? { channelNumber: channel.ChannelNumber } : {}) } }),
        },
        { text: t("common.cancel"), style: "cancel" as const },
      ]);
    },
    [router],
  );
  return useCallback(
    (channel: JellyfinItem) => {
      const favorite = isFavoriteChannel(getLiveTvPreferences(), channel);
      Alert.alert(channel.Name, undefined, [
        { text: favorite ? t("liveTv.unfavorite") : t("liveTv.favorite"), style: favorite ? "destructive" : "default", onPress: () => toggleFavoriteChannel(channel) },
        { text: t("liveTv.addToGroup"), onPress: () => openGroups(channel) },
        { text: t("common.cancel"), style: "cancel" },
      ]);
    },
    [openGroups],
  );
}
