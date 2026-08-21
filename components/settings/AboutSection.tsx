import { FocusableButton } from "@/components/FocusableButton";
import { ABOUT_LABEL, ABOUT_LABEL_VERSIONED, APP_BUILD_NUMBER, APP_VERSION } from "@/constants/app";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
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
 * The build's version hides behind a long press. It is the app's only version display and the
 * licenses behind the link are this build's, so it belongs here, but a viewer reading a settings
 * screen is not asking what build they are on: on the row it was noise, one press away it is not.
 */
export function AboutSection() {
  const router = useRouter();
  const [showVersion, setShowVersion] = useState(false);
  const openLicenses = useCallback(() => router.push("/licenses"), [router]);
  // A long press consumes the press, so revealing the version never navigates.
  const toggleVersion = useCallback(() => setShowVersion((v) => !v), []);

  return (
    <View style={styles.container}>
      <FocusableButton
        title={showVersion ? ABOUT_LABEL_VERSIONED : ABOUT_LABEL}
        accessibilityLabel={showVersion && APP_VERSION ? `${ABOUT_LABEL}, version ${APP_VERSION}${APP_BUILD_NUMBER ? `, build ${APP_BUILD_NUMBER}` : ""}` : ABOUT_LABEL}
        variant="link"
        onPress={openLicenses}
        onLongPress={toggleVersion}
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
