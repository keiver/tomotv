import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { t } from "@/services/i18n";
import { updateUiPreferences } from "@/services/uiPreferences";
import React, { useCallback } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

/** Interface choices kept on this device. Device posters only: chapter stills and channel sampling ignore it. */
export function UiSection() {
  const { devicePosters } = useUiPreferences();
  const toggleDevicePosters = useCallback(() => updateUiPreferences({ devicePosters: !devicePosters }), [devicePosters]);

  return (
    <>
      <View style={[settingsStyles.sectionHeader, styles.header]}>
        <Text style={settingsStyles.sectionHeaderText}>{t("settings.ui")}</Text>
      </View>
      <View style={settingsStyles.section}>
        <ListRow
          icon="image"
          title={t("settings.devicePosters")}
          trailingIcon={devicePosters ? tick : undefined}
          onPress={toggleDevicePosters}
          isFirst
          isLast
          accessibilityState={{ checked: devicePosters }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // Matches the About header below it.
  header: {
    paddingTop: Platform.isTV ? 16 : 14,
  },
});
