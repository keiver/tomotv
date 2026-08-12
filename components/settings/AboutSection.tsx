import { FocusableButton } from "@/components/FocusableButton";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";

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
 *
 * Presented as a small centred link rather than a sunken settings row with a
 * heading: it is a legal destination that must be reachable, not a setting
 * anyone came here to change, and the heading gave it more weight than it earns.
 *
 * Labelled "Open Source" rather than "Acknowledgements" so it matches the title
 * the destination already renders, and because that is the phrase this audience
 * recognises. Not "Disclaimers": the page disclaims nothing, it credits authors
 * and carries the LGPL written offer of source, and naming an obligation after
 * its opposite is the kind of thing that matters if anyone ever checks.
 */
export function AboutSection() {
  const router = useRouter();
  const openLicenses = useCallback(() => router.push("/licenses"), [router]);

  return (
    <View style={styles.container}>
      <FocusableButton title="Open Source" variant="link" onPress={openLicenses} style={styles.button} textStyle={styles.label} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", marginTop: 24 },
  button: { paddingVertical: 10, paddingHorizontal: 20, alignSelf: "center" },
  label: { fontSize: 17 },
});
