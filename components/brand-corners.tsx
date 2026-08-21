import { Image, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

const DOCS_HOST = "tomotv.app";

// Large enough to resolve from arm's length, small enough to stay a corner mark. The
// 10:1 rule wants ~400pt of code for a 2m couch; this yields ~190pt, so it is a
// lean-in affordance rather than a sofa scan.
const QR_SIZE = 240;

// Inset by 2% of the axis, floored at the overscan safe area. 2% of 1920 is 38pt and 2%
// of 1080 is 22pt, but a real Apple TV reports {59, 90, 59, 90} — the raw percentage
// would drop both corners into the band a TV is free to crop. Same Math.max that
// gridEdgePadding applies to the library grid.
const CORNER_RATIO = 0.02;
const TV_SAFE_X = 90;
const TV_SAFE_Y = 60;

/**
 * BrandCorners — the setup-guide QR in the bottom-right, and its host caption.
 *
 * tvOS only: a QR is useless on the device you would scan it with. No name mark rides with
 * it — the caption under the code already reads tomotv.app, which names the app and where to
 * go for it in one line. The version is not here either, on either platform: it hides behind a
 * long press on the Open Source link in Settings, where the licenses it qualifies actually live.
 *
 * CALLER CONSTRAINT: render this BEFORE any focusable sibling. Siblings paint in order,
 * and on tvOS a view drawn above a focusable occludes it — the focus engine refuses to
 * enter and pointerEvents cannot opt out. The corner is also clear of the centred content
 * column (1000pt wide, so x 460-1460 on a 1920 screen), so its frame never intersects a row.
 */
export function BrandCorners() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  if (!IS_TV) return null;

  const cornerX = Math.max(width * CORNER_RATIO, insets.left, insets.right, TV_SAFE_X);
  const cornerY = Math.max(height * CORNER_RATIO, insets.bottom, TV_SAFE_Y);

  return (
    <View style={[styles.qr, { right: cornerX, bottom: cornerY }]}>
      <Image
        source={require("@/assets/images/tomotv-qr-1000px.png")}
        style={styles.qrImage}
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={`QR code for the setup guide at ${DOCS_HOST}`}
      />
      <Text style={styles.caption}>{DOCS_HOST}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // No fill and no radius: the asset is amber modules on transparency, so it sits
  // straight on the canvas. A white plate behind it would just be a box.
  qr: {
    position: "absolute",
    alignItems: "center",
  },
  qrImage: {
    width: QR_SIZE,
    height: QR_SIZE,
  },
  // Amber rather than the usual neutral grey: the code above it is amber and so is the
  // spine on the opposite edge, so a grey caption was the one piece of corner furniture
  // that belonged to nothing. Held well under the code's own strength so it labels the
  // mark instead of competing with it.
  caption: {
    fontSize: 22,
    fontWeight: "600",
    color: "rgba(255, 195, 18, 0.55)",
    letterSpacing: 0.5,
    marginTop: 6,
  },
});
