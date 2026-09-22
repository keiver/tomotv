import { GlassButton } from "@/components/glass-button";
import { SfSymbolIcon } from "@/components/sf-symbol-icon";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { updateLiveTvPreferences } from "@/services/liveTvPreferences";
import React, { useCallback } from "react";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;

interface ShowAllChannelsProps {
  hasTVPreferredFocus?: boolean;
}

/** The wall's empty favorites state: the filled filter symbol, one press lifts the filter. */
export function ShowAllChannels({ hasTVPreferredFocus = false }: ShowAllChannelsProps) {
  const showAll = useCallback(() => updateLiveTvPreferences({ favoritesOnly: false }), []);
  return (
    <View style={styles.row}>
      <GlassButton
        accessibilityLabel={t("liveTv.showAll")}
        icon={<SfSymbolIcon name="line.3.horizontal.decrease.circle.fill" size={IS_TV ? 28 : 20} color={COLORS.ACCENT} />}
        onPress={showAll}
        hasTVPreferredFocus={hasTVPreferredFocus}
        style={IS_TV ? undefined : styles.phonePill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: IS_TV ? 32 : 20,
  },
  phonePill: {
    minHeight: 36,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
});
