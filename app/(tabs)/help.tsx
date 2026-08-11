import { AmbientBackground } from "@/components/ambient-background";
import { FeatureProse } from "@/components/feature-prose";
import { HelpRow } from "@/components/help-row";
import { settingsStyles } from "@/components/settings/styles";
import { DOCS_HOST, DOCS_URL, HELP_PROSE, HELP_STRINGS, ISSUES_HOST, ISSUES_URL } from "@/constants/help-copy";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Image, Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

// Phone tab bar height (mirrors library-grid.tsx); the scroll content must clear it.
const PHONE_TAB_BAR_HEIGHT = 49;

// tvOS reports an 80pt horizontal overscan inset, but a real panel's safe area is
// {59, 90, 59, 90} — take the larger so the columns clear the bezel either way.
const TV_SIDE_PADDING = 90;

// The asset carries its own white margin — about 11% a side, comfortably the four
// modules ISO 18004 asks for — so the frame adds no padding and every point goes
// to the code. At 500 the modules themselves span ~390pt, close to the quarter of
// a 1920pt canvas the 10:1 rule wants for a 2m couch, and as large as the column
// fits without pushing the rows off the bottom edge. The old 280pt image put
// ~218pt of code on screen, under what a phone camera resolves from a sofa.
const QR_SIZE = 500;

// Top Shelf is the Apple TV home-screen row, so the clause that names it comes
// out on iPhone. Each clause carries its own leading connector, which is what
// keeps the sentence grammatical with the middle of the list removed.
const PHONE_PROSE = HELP_PROSE.filter((clause) => !clause.tvOnly);

// app.json is the only version source that needs no extra native module. It
// pins buildNumber at "1", which says nothing true about an installed binary,
// so the marketing version goes on screen alone.
const VERSION = Constants.expoConfig?.version;

const openDocs = () => Linking.openURL(DOCS_URL);
const openIssues = () => Linking.openURL(ISSUES_URL);

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const openLicenses = useCallback(() => router.push("/licenses"), [router]);

  // Phone: one scrolling column of grouped sections, the same shape Settings and
  // the Acknowledgements screen use. The setup guide opens with a tap here — no
  // QR, because you can't scan the screen you're holding.
  if (!IS_TV) {
    return (
      <View style={settingsStyles.screenContainer}>
        <AmbientBackground />

        <ScrollView
          style={settingsStyles.scrollView}
          contentContainerStyle={[settingsStyles.scrollContent, { paddingTop: insets.top + 16, paddingBottom: PHONE_TAB_BAR_HEIGHT + insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}>
          <View style={settingsStyles.contentContainer}>
            <View style={styles.phoneHero}>
              <Image source={require("@/assets/brand/tomo-tv.png")} style={styles.phoneAppIcon} accessible={true} accessibilityRole="image" accessibilityLabel={`${HELP_STRINGS.appName} app icon`} />
              <Text style={styles.phoneTitle}>{HELP_STRINGS.appName}</Text>
              {VERSION ? <Text style={styles.version}>Version {VERSION}</Text> : null}
            </View>

            <FeatureProse clauses={PHONE_PROSE} style={styles.phoneProse} />

            <View style={settingsStyles.sectionHeader}>
              <Text style={settingsStyles.sectionHeaderText}>{HELP_STRINGS.setupHeader}</Text>
            </View>
            <View style={settingsStyles.section}>
              <HelpRow icon="book-outline" title={DOCS_HOST} subtitle={HELP_STRINGS.setupHintPhone} onPress={openDocs} accessory="external" isFirst isLast />
            </View>

            <View style={settingsStyles.sectionHeader}>
              <Text style={settingsStyles.sectionHeaderText}>{HELP_STRINGS.supportHeader}</Text>
            </View>
            <View style={settingsStyles.section}>
              <HelpRow icon="bug-outline" title={HELP_STRINGS.reportIssue} subtitle={ISSUES_HOST} onPress={openIssues} accessory="external" isFirst isLast />
            </View>

            <View style={settingsStyles.sectionHeader}>
              <Text style={settingsStyles.sectionHeaderText}>{HELP_STRINGS.openSourceHeader}</Text>
            </View>
            <View style={settingsStyles.section}>
              <HelpRow icon="ribbon-outline" title={HELP_STRINGS.acknowledgements} onPress={openLicenses} accessory="chevron" isFirst isLast />
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  // TV: text left, every focusable right. The paragraph opens "Tomo TV is a…" so
  // it has to sit directly under the wordmark, and putting the rows opposite it
  // gives the remote somewhere to land — this screen used to hold exactly one
  // focusable element. Nothing scrolls: a block with no focusable children can't
  // be scrolled by the focus engine, so the copy is sized to fit instead.
  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />

      <View
        style={[
          styles.columns,
          {
            paddingTop: insets.top + 16,
            paddingBottom: Math.max(insets.bottom, 60),
            paddingLeft: Math.max(insets.left, TV_SIDE_PADDING),
            paddingRight: Math.max(insets.right, TV_SIDE_PADDING),
          },
        ]}>
        <View style={styles.leftColumn}>
          <View style={styles.tvHero}>
            <Image source={require("@/assets/brand/tomo-tv.png")} style={styles.tvAppIcon} accessible={true} accessibilityRole="image" accessibilityLabel={`${HELP_STRINGS.appName} app icon`} />
            <View>
              <Text style={styles.tvTitle}>{HELP_STRINGS.appName}</Text>
              {VERSION ? <Text style={styles.version}>Version {VERSION}</Text> : null}
            </View>
          </View>

          <FeatureProse clauses={HELP_PROSE} style={styles.tvProse} />
        </View>

        <View style={styles.rightColumn}>
          <View style={styles.qrBlock}>
            <View style={styles.qrFrame}>
              <Image
                source={require("@/assets/images/tomotv-qr-1000px.png")}
                style={styles.qrImage}
                accessible={true}
                accessibilityRole="image"
                accessibilityLabel={`QR code for the setup guide at ${DOCS_HOST}`}
              />
            </View>
            <Text style={styles.qrUrl}>{DOCS_HOST}</Text>
            <Text style={styles.qrHint}>{HELP_STRINGS.setupHintTv}</Text>
          </View>

          {/* No browser on tvOS to hand a URL to, so the issue tracker is stated
              rather than linked. It still takes focus: an unfocusable column is
              one the remote skips over entirely. */}
          <View style={settingsStyles.section}>
            <HelpRow icon="bug-outline" title={HELP_STRINGS.reportIssue} subtitle={ISSUES_HOST} accessory="none" isFirst />
            <HelpRow icon="ribbon-outline" title={HELP_STRINGS.acknowledgements} onPress={openLicenses} accessory="chevron" isLast />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // TV layout — fixed two columns, never scrolled.
  columns: {
    flex: 1,
    flexDirection: "row",
    gap: 80,
  },
  leftColumn: {
    flex: 1,
  },
  // Fixed to the QR's width so the code and the rows below it share one edge —
  // a flexed column left the card noticeably wider than the thing it sits under.
  rightColumn: {
    width: QR_SIZE,
    justifyContent: "space-between",
  },

  // Hero. No glow behind the icon: a 40pt amber halo on an app icon is a
  // decoration the rest of the app doesn't use.
  tvHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 28,
    marginBottom: 48,
  },
  tvAppIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  tvTitle: {
    fontSize: 72,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -2,
  },
  phoneHero: {
    marginBottom: 24,
  },
  phoneAppIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 12,
  },
  phoneTitle: {
    fontSize: 44,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -2,
  },
  version: {
    fontSize: IS_TV ? 24 : 15,
    fontWeight: "500",
    color: "#8E8E93",
    marginTop: IS_TV ? 6 : 4,
  },
  phoneProse: {
    marginBottom: 12,
  },
  // The left column runs the full remaining width, which at 32pt puts ~55
  // characters on a line — long enough that the eye loses its place walking back
  // to the next one. Capping the measure also gives the block enough height to
  // stand against the QR rail opposite it.
  tvProse: {
    maxWidth: 900,
  },

  // Setup guide. The card, its gradient and the circular white frame are gone:
  // the QR is the content, and a circle clips the quiet zone the code needs on
  // all four sides.
  qrBlock: {
    alignItems: "center",
  },
  qrFrame: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 20,
  },
  qrImage: {
    width: QR_SIZE,
    height: QR_SIZE,
  },
  qrUrl: {
    fontSize: 28,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  qrHint: {
    fontSize: 22,
    color: "#98989D",
    marginTop: 4,
  },
});
