import { FocusableButton } from "@/components/FocusableButton";
import { ABOUT_LABEL, APP_BUILD_NUMBER, APP_VERSION } from "@/constants/app";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";

/**
 * AboutSection — the Acknowledgements entry point.
 *
 * Not optional and not decoration. `app/licenses.tsx` carries the license texts and the
 * LGPL source offer for FFmpeg, GnuTLS, libtasn1, libunistring and Nettle, and the Help
 * tab that used to push it is gone, so this is its only entry point.
 *
 * Rendered by the connected Settings tab only. The logged-out view (the Settings tab
 * with no server, and the same screen Home and Search show in place of their content)
 * is the server list and nothing else, so a link under it cannot read as a second step
 * in connecting.
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
 *
 * It also carries the build's version. The licenses behind it are this build's, so the version
 * qualifies the destination rather than merely sharing a row with it — which is what let the phone
 * brand spine go back to being a name.
 */
export function AboutSection() {
  const router = useRouter();
  const openLicenses = useCallback(() => router.push("/licenses"), [router]);

  return (
    <View style={styles.container}>
      <FocusableButton
        title={ABOUT_LABEL}
        accessibilityLabel={APP_VERSION ? `Open Source, version ${APP_VERSION}${APP_BUILD_NUMBER ? `, build ${APP_BUILD_NUMBER}` : ""}` : "Open Source"}
        variant="link"
        onPress={openLicenses}
        style={styles.button}
        textStyle={styles.label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // marginBottom lifts the link clear of the phone's floating tab bar, which the label was
  // touching once it became the last thing in the scroll content.
  container: { alignItems: "center", marginTop: 4, marginBottom: 20 },
  button: { paddingVertical: 10, paddingHorizontal: 20, alignSelf: "center" },
  label: { fontSize: 17 },
});
