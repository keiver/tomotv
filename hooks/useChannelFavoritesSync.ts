import { useAppStateRefresh } from "@/hooks/useAppStateRefresh";
import { useAuthSession } from "@/hooks/useAuthSession";
import { syncChannelFavorites } from "@/services/channelFavorites";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

/** Reads the server's channel favorites into the device list while the screen is on top: on focus, sign-in and foreground. */
export function useChannelFavoritesSync(): void {
  const isFocused = useIsFocused();
  const session = useAuthSession();
  const focusedRef = useRef(isFocused);
  useEffect(() => {
    focusedRef.current = isFocused;
    if (isFocused) void syncChannelFavorites();
  }, [isFocused, session]);
  const onForeground = useCallback(() => {
    if (focusedRef.current) void syncChannelFavorites();
  }, []);
  useAppStateRefresh(onForeground, "ChannelFavorites");
}
