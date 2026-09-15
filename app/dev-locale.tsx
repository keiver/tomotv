import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { View } from "react-native";

import { COLORS } from "@/constants/colors";
import { setLocaleOverride } from "@/services/i18n";
import { logger } from "@/utils/logger";

/**
 * Dev builds only: renders the app in one store language, so the screenshot
 * pipeline captures a German listing's screens in German. Without it every
 * locale's captures show the same English UI under a translated caption.
 *
 * tomotv://dev-locale?lang=de
 */
export default function DevLocaleScreen() {
  const { lang } = useLocalSearchParams<{ lang?: string }>();
  const router = useRouter();

  useEffect(() => {
    if (!__DEV__ || !lang) {
      router.dismissTo("/");
      return;
    }
    void (async () => {
      const picked = await setLocaleOverride(lang);
      logger.info("Locale override applied", { service: "DevLocale", requested: lang, applied: picked });
      router.dismissTo("/");
    })();
  }, [lang, router]);

  return <View style={{ flex: 1, backgroundColor: COLORS.BACKGROUND }} />;
}
