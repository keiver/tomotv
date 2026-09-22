import { t } from "@/services/i18n";
import { getLiveTvPreferences, isFavoriteChannel, toggleFavoriteChannel } from "@/services/liveTvPreferences";
import type { JellyfinItem } from "@/types/jellyfin";
import { useCallback } from "react";
import { Alert } from "react-native";

/** A held channel card: the native sheet offers to add or remove the favorite, one press to confirm. */
export function useChannelFavoriteMenu(): (channel: JellyfinItem) => void {
  return useCallback((channel: JellyfinItem) => {
    const favorite = isFavoriteChannel(getLiveTvPreferences(), channel);
    Alert.alert(channel.Name, undefined, [
      { text: favorite ? t("liveTv.unfavorite") : t("liveTv.favorite"), style: favorite ? "destructive" : "default", onPress: () => toggleFavoriteChannel(channel) },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }, []);
}
