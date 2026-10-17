import { CloseOverlayButton } from "@/components/close-overlay-button";
import { t } from "@/services/i18n";
import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The phone info panel's ✕, top right, clear of the right inset of the safe area it is rendered in. */
export function InfoCloseButton({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return <CloseOverlayButton onPress={onPress} style={{ position: "absolute", top: 12, right: 12 + insets.right }} accessibilityHint={t("info.closeHint")} />;
}
