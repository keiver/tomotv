import { COLORS } from "@/constants/colors";
import { useFinishLogin } from "@/hooks/useFinishLogin";
import { saveAuthResult } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { View } from "react-native";

type DevSessionParams = {
  server?: string;
  token?: string;
  userId?: string;
  userName?: string;
  serverName?: string;
  serverId?: string;
  deviceId?: string;
};

/**
 * Dev builds only: installs a session minted outside the app, so a simulator signs in
 * from a shell. tomotv://dev-session?server=&token=&userId=&userName=&serverName=&serverId=&deviceId=
 */
export default function DevSessionScreen() {
  const { server, token, userId, userName, serverName, serverId, deviceId } = useLocalSearchParams<DevSessionParams>();
  const finishLogin = useFinishLogin();
  const router = useRouter();

  useEffect(() => {
    if (!__DEV__ || !server || !token || !userId) {
      router.dismissTo("/");
      return;
    }
    void (async () => {
      try {
        await saveAuthResult(server, token, userId, userName ?? "dev", serverName ?? server, "password", serverId, deviceId);
        await finishLogin();
      } catch (error) {
        logger.error("Dev session install failed", error, { service: "DevSession", server });
        router.dismissTo("/");
      }
    })();
  }, [server, token, userId, userName, serverName, serverId, deviceId, finishLogin, router]);

  return <View style={{ flex: 1, backgroundColor: COLORS.BACKGROUND }} />;
}
