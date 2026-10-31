import { FocusableButton } from "@/components/FocusableButton";
import { useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

interface TakeMatchesBarProps {
  count: number;
  busy: boolean;
  onPress: () => void;
}

/** One button for the whole set: applies every hash match and lone result at once. Hidden when there are none. */
export function TakeMatchesBar({ count, busy, onPress }: TakeMatchesBarProps) {
  const palette = useCardPalette();
  if (count === 0) return null;
  return (
    <View style={styles.bar}>
      <FocusableButton
        title={t("subtitles.takeMatches").replace("{count}", String(count))}
        variant="primary"
        isLoading={busy}
        icon={<Ionicons name="checkmark-done" size={Platform.isTV ? 34 : 22} color={palette.onAccent} />}
        onPress={onPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginBottom: Platform.isTV ? 24 : 14,
  },
});
