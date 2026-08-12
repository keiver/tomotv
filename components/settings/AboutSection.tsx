import { InfoRow } from "@/components/settings/InfoRow";
import { settingsStyles as styles } from "@/components/settings/styles";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { Text, View } from "react-native";

/**
 * AboutSection — the Acknowledgements entry point.
 *
 * Not optional and not decoration. `app/licenses.tsx` carries the license texts and the
 * LGPL source offer for FFmpeg, GnuTLS, libtasn1, libunistring and Nettle, and the Help
 * tab that used to push it is gone. It therefore has to appear on every surface a user
 * can be sitting on for a while: the Settings tab in both states, and the logged-out
 * view that Home and Search show in place of their content.
 *
 * The offer cannot sit behind a login, which is why this renders regardless of
 * connection state rather than only once a server is attached.
 */
export function AboutSection() {
  const router = useRouter();
  const openLicenses = useCallback(() => router.push("/licenses"), [router]);

  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>ABOUT</Text>
      </View>
      <View style={styles.section}>
        <InfoRow icon="ribbon-outline" title="Acknowledgements" onPress={openLicenses} accessory="chevron" isFirst isLast />
      </View>
    </>
  );
}
