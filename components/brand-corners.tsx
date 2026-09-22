import { qrPngDataUri } from "@/utils/qrPng";
import qrcodeGenerator from "qrcode-generator";
import { Image, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

const DOCS_HOST = "tomotv.app";
export const DOCS_URL = `https://${DOCS_HOST}/`;

/** ~190pt of code at 240pt: a lean-in mark, not a sofa scan. */
const QR_SIZE = 240;
const MODULE_PX = 12;
const AMBER: [number, number, number] = [255, 195, 18];

// 2% of the axis, floored at the overscan safe area a real Apple TV reports ({59, 90}).
const CORNER_RATIO = 0.02;
const TV_SAFE_X = 90;
const TV_SAFE_Y = 60;

let docsQr: string | undefined;

/** The setup-guide code, encoded once per process and kept. */
export function docsQrDataUri(): string {
  if (docsQr) return docsQr;
  const qr = qrcodeGenerator(0, "M");
  qr.addData(DOCS_URL);
  qr.make();
  docsQr = qrPngDataUri(qr.getModuleCount(), (row, col) => qr.isDark(row, col), MODULE_PX, AMBER);
  return docsQr;
}

/**
 * The setup-guide QR in the bottom-right with its host caption, tvOS only.
 * Render BEFORE any focusable sibling: on tvOS a view drawn above a focusable occludes it.
 */
export function BrandCorners() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  if (!IS_TV) return null;

  const cornerX = Math.max(width * CORNER_RATIO, insets.left, insets.right, TV_SAFE_X);
  const cornerY = Math.max(height * CORNER_RATIO, insets.bottom, TV_SAFE_Y);

  return (
    <View style={[styles.qr, { right: cornerX, bottom: cornerY }]}>
      <Image source={{ uri: docsQrDataUri() }} style={styles.qrImage} accessible={true} accessibilityRole="image" accessibilityLabel={`QR code for the setup guide at ${DOCS_HOST}`} />
      <Text style={styles.caption}>{DOCS_HOST}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Amber modules on transparency sit straight on the canvas: no plate, no radius.
  qr: {
    position: "absolute",
    alignItems: "center",
  },
  qrImage: {
    width: QR_SIZE,
    height: QR_SIZE,
  },
  caption: {
    fontSize: 22,
    fontWeight: "600",
    color: "rgba(255, 195, 18, 0.55)",
    letterSpacing: 0.5,
    marginTop: 6,
  },
});
