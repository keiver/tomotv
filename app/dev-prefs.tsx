import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { View } from "react-native";

import { COLORS } from "@/constants/colors";
import { getUiPreferences, SERVER_TRANSCODING_LEVELS, updateUiPreferences } from "@/services/uiPreferences";
import { logger } from "@/utils/logger";

type DevPrefsParams = { serverTranscoding?: string; probe?: string };

/**
 * Dev builds only: the playback suite sets the preference a run assumes and
 * restores the device's own afterwards; the previous value answers on `probe`.
 *
 * tomotv://dev-prefs?serverTranscoding=linkOrFile&probe=http://host:port/probe
 */
export default function DevPrefsScreen() {
  const { serverTranscoding, probe } = useLocalSearchParams<DevPrefsParams>();
  const router = useRouter();

  useEffect(() => {
    if (!__DEV__) {
      router.dismissTo("/");
      return;
    }
    const level = SERVER_TRANSCODING_LEVELS.find((candidate) => candidate === serverTranscoding);
    const previous = getUiPreferences().serverTranscoding;
    if (level) updateUiPreferences({ serverTranscoding: level });
    else logger.warn("Prefs override ignored, not a transcoding level", { service: "DevPrefs", requested: serverTranscoding });
    logger.info("Prefs override applied", { service: "DevPrefs", requested: serverTranscoding, applied: level ?? null, previous });
    if (probe && /^https?:\/\//.test(probe)) {
      void fetch(probe, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: "dev-prefs", previous: { serverTranscoding: previous } }),
      }).catch(() => {});
    }
    router.dismissTo("/");
  }, [serverTranscoding, probe, router]);

  return <View style={{ flex: 1, backgroundColor: COLORS.BACKGROUND }} />;
}
