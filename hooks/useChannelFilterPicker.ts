import { useChannelFilterChoices } from "@/hooks/useChannelFilterChoices";
import { t } from "@/services/i18n";
import { getLiveTvPreferences, updateLiveTvPreferences } from "@/services/liveTvPreferences";
import { useCallback } from "react";
import { Alert } from "react-native";

/** The channel filters as a native sheet, the picked one ticked, one press to switch. */
export function useChannelFilterPicker(): () => void {
  const choices = useChannelFilterChoices();
  return useCallback(() => {
    const { filter } = getLiveTvPreferences();
    Alert.alert(t("liveTv.channels"), undefined, [
      ...choices.map((choice) => ({ text: choice.filter === filter ? `✓ ${choice.label}` : choice.label, onPress: () => updateLiveTvPreferences({ filter: choice.filter }) })),
      { text: t("common.cancel"), style: "cancel" as const },
    ]);
  }, [choices]);
}
