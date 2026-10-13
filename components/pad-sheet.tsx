import { CloseOverlayButton } from "@/components/close-overlay-button";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { IS_MAC } from "@/utils/hostEnvironment";
import { BlurView } from "expo-blur";
import React from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Measured off the page sheet this replaces (1560px shot: 1413 wide, centred), so it keeps its frame. */
const PAD_SHEET_RATIO = 0.905;
/** An 11" iPad's portrait sheet: landscape and a wide Mac window keep that reading width, centred. */
const PAD_SHEET_MAX_WIDTH = 760;
/** Fitted card width caps: iPad's centred card holds the info panel's hero and cast row, iPhone's bottom card spans the screen. */
const FIT_MAX_WIDTH = { center: 640, bottom: 600 } as const;
/** iPad's centred card stops short of the screen's edges; a longer panel scrolls inside it. */
const FIT_MAX_HEIGHT = { center: 900, bottom: Infinity } as const;
const FIT_MARGIN = 8;
/** A Mac window is short and its title-bar tabs sit on the content's top edge: the card keeps a window-proportional gap. */
const MAC_WINDOW_SHARE = 0.85;

export function padSheetWidth(windowWidth: number): number {
  return Math.min(Math.round(windowWidth * PAD_SHEET_RATIO), PAD_SHEET_MAX_WIDTH);
}

export function padFitWidth(windowWidth: number, insetsX: number, fit: "center" | "bottom"): number {
  return Math.min(windowWidth - FIT_MARGIN * 2 - insetsX, FIT_MAX_WIDTH[fit]);
}

export function padFitMaxHeight(windowHeight: number, insetTop: number, insetBottom: number, fit: "center" | "bottom", isMac: boolean = IS_MAC): number {
  const inWindow = windowHeight - insetTop - Math.max(insetBottom, FIT_MARGIN) - FIT_MARGIN * 2;
  return Math.min(isMac && fit === "center" ? Math.round(windowHeight * MAC_WINDOW_SHARE) : inWindow, inWindow, FIT_MAX_HEIGHT[fit]);
}

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
  return (
    <PadSheetBackdrop onClose={onClose} fit={fit}>
      <PadSheetFrame onClose={onClose} closeHint={closeHint} fit={fit}>
        {children}
      </PadSheetFrame>
    </PadSheetBackdrop>
  );
}

/** The blur and the dismissing dim, laying out what rides above them by `fit`. */
export function PadSheetBackdrop({ onClose, fit, children }: Omit<PadSheetProps, "closeHint">) {
  return (
    <View style={[styles.root, fit === "center" && styles.rootCenter, fit === "bottom" && styles.rootBottom]}>
      {/* iOS has no blurred presentation style of its own: UIModalPresentationBlurOverFullScreen is tvOS only. */}
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      {/* The dim rides on the dismiss target: blurred artwork is still bright artwork, and it
          is what hides the screen behind if a device gives us no blur. */}
      <Pressable style={[StyleSheet.absoluteFill, styles.dim]} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("info.close")} />
      {children}
    </View>
  );
}

/** The card itself, with its close button. */
export function PadSheetFrame({ onClose, closeHint, fit, children }: PadSheetProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const frame = fit
    ? [
        styles.fitted,
        {
          width: padFitWidth(width, insets.left + insets.right, fit),
          maxHeight: padFitMaxHeight(height, insets.top, insets.bottom, fit),
          marginBottom: fit === "bottom" ? Math.max(insets.bottom, FIT_MARGIN) : 0,
        },
      ]
    : [styles.sheet, { width: padSheetWidth(width), marginTop: insets.top + 8 }];
  return (
    <View style={frame}>
      {children}
      <CloseOverlayButton onPress={onClose} style={styles.close} accessibilityHint={closeHint} />
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
