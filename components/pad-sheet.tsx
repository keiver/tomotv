import { CloseOverlayButton } from "@/components/close-overlay-button";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { BlurView } from "expo-blur";
import React from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Measured off the page sheet this replaces (1560px shot: 1413 wide, centred), so it keeps its frame. */
export const PAD_SHEET_RATIO = 0.905;
/** Fitted card width caps: iPad's centred card reads as a dialog, iPhone's bottom card spans the screen. */
const FIT_MAX_WIDTH = { center: 440, bottom: 600 } as const;
const FIT_MARGIN = 8;

interface PadSheetProps {
  onClose: () => void;
  closeHint?: string;
  /** Size the card to its content, centred (iPad) or on the bottom edge (iPhone), instead of a full-height page. */
  fit?: "center" | "bottom";
  children: React.ReactNode;
}

/**
 * iPad's panel frame over the app (UIModalPresentationOverFullScreen): a blur of the screen behind,
 * a dim that dismisses on tap, and a page sheet's own width and top gap.
 */
export function PadSheet({ onClose, closeHint, fit, children }: PadSheetProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const frame = fit
    ? [
        styles.fitted,
        {
          width: Math.min(width - FIT_MARGIN * 2 - insets.left - insets.right, FIT_MAX_WIDTH[fit]),
          maxHeight: height - insets.top - Math.max(insets.bottom, FIT_MARGIN) - FIT_MARGIN * 2,
          marginBottom: fit === "bottom" ? Math.max(insets.bottom, FIT_MARGIN) : 0,
        },
      ]
    : [styles.sheet, { width: Math.round(width * PAD_SHEET_RATIO), marginTop: insets.top + 8 }];
  return (
    <View style={[styles.root, fit === "center" && styles.rootCenter, fit === "bottom" && styles.rootBottom]}>
      {/* iOS has no blurred presentation style of its own: UIModalPresentationBlurOverFullScreen is tvOS only. */}
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      {/* The dim rides on the dismiss target: blurred artwork is still bright artwork, and it
          is what hides the screen behind if a device gives us no blur. */}
      <Pressable style={[StyleSheet.absoluteFill, styles.dim]} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("info.close")} />
      <View style={frame}>
        {children}
        <CloseOverlayButton onPress={onClose} style={styles.close} accessibilityHint={closeHint} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
  },
  rootCenter: {
    justifyContent: "center",
  },
  rootBottom: {
    justifyContent: "flex-end",
  },
  dim: {
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  // BACKGROUND, not the section's SURFACE: the hero gradient's bottom stop is the phone
  // colour, and a lighter surface under it would show a seam across the artwork.
  sheet: {
    flex: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
    backgroundColor: COLORS.BACKGROUND,
  },
  fitted: {
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: COLORS.BACKGROUND,
  },
  close: {
    position: "absolute",
    top: 12,
    right: 12,
  },
});
