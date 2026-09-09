import { qrPngDataUri } from "@/utils/qrPng";
import qrcode from "qrcode-generator";
import { Image, Platform, StyleSheet, useWindowDimensions, View } from "react-native";

const IS_TV = Platform.isTV;
/** Pixels per module. Downscaled by the Image to whatever the layout asks for, so it stays crisp. */
const MODULE_PX = 12;
const AMBER: [number, number, number] = [255, 195, 18];

/** The deep link a phone opens to join this group. Carries no credentials: the phone must
 *  already be signed into the same server, matched by serverId on the receiving screen. */
export function buildJoinLink(serverId: string, groupId: string): string {
  return `tomotv:///syncplay?serverId=${encodeURIComponent(serverId)}&groupId=${encodeURIComponent(groupId)}`;
}

// Built once per link and kept: opening the panel again, or reopening after a switch, reuses
// the same image instead of re-encoding and re-mounting.
const cache = new Map<string, string>();

export function joinQrDataUri(serverId: string, groupId: string): string {
  const link = buildJoinLink(serverId, groupId);
  const hit = cache.get(link);
  if (hit) return hit;
  const qr = qrcode(0, "M");
  qr.addData(link);
  qr.make();
  const uri = qrPngDataUri(qr.getModuleCount(), (row, col) => qr.isDark(row, col), MODULE_PX, AMBER);
  cache.set(link, uri);
  return uri;
}

/**
 * JoinQr: the group's join code as one image, amber modules on transparency, the canvas its
 * own quiet zone. A module-per-view grid mounted over a thousand views and was slow on tvOS.
 */
export function JoinQr({ serverId, groupId, size: sizeProp }: { serverId: string; groupId: string; size?: number }) {
  const { width } = useWindowDimensions();
  const size = sizeProp ?? (IS_TV ? 420 : Math.min(320, Math.round(width * 0.62)));

  return (
    <View style={styles.wrap} collapsable={false}>
      <Image
        source={{ uri: joinQrDataUri(serverId, groupId) }}
        style={{ width: size, height: size }}
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel="QR code to join this group from another device"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
  },
});
