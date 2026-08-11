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

// Resolves to the running binary's CFBundleShortVersionString, not to app.json —
// a sim holding an older build reports that older build, which is what an About
// screen should say. buildNumber is deliberately left off: app.json pins it at
// "1", which says nothing true about an installed binary.
const VERSION = Constants.expoConfig?.version;

// Every About screen in this category states the same three facts: app version,
// OS, and device. Max calls the section "Info", Kodi calls it "System
// Information", Plex folds it into "Acknowledgements" — all of them read-only.
// Here it also happens to be the line you need when filing the issue the row
// below opens. Device model is left out: expo-constants deprecated it in favour
// of expo-device, and it returns null often enough not to build a line on.
// `Platform.constants.systemName` carries the name natively but isn't narrowed by
// Platform.OS, which is "ios" on both. This app ships to those two platforms only,
// so the flag names it without a cast.
const OS_LINE = `${IS_TV ? "tvOS" : "iOS"} ${Platform.Version}`;

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
              <View>
                <Text style={styles.phoneTitle}>{HELP_STRINGS.appName}</Text>
                <Text style={styles.version}>{VERSION ? `Version ${VERSION} · ${OS_LINE}` : OS_LINE}</Text>
              </View>
            </View>

            <FeatureProse clauses={PHONE_PROSE} style={styles.phoneProse} />

            {/* One card, not three. Each of these is a single self-describing row,
                so a header apiece ("SETUP GUIDE" over a row already subtitled
                "From first connection to subtitles") was three labels and two card
                gaps of chrome carrying no information. Grouped, the phone reads the
                same as the TV column opposite it. */}
            <View style={settingsStyles.section}>
              <HelpRow icon="book-outline" title={DOCS_HOST} subtitle={HELP_STRINGS.setupHintPhone} onPress={openDocs} accessory="external" isFirst />
              <HelpRow icon="bug-outline" title={HELP_STRINGS.reportIssue} subtitle={ISSUES_HOST} onPress={openIssues} accessory="external" />
              <HelpRow icon="ribbon-outline" title={HELP_STRINGS.acknowledgements} onPress={openLicenses} accessory="chevron" isLast />
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
              <Text style={styles.version}>{VERSION ? `Version ${VERSION} · ${OS_LINE}` : OS_LINE}</Text>
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
  // Top-aligned, not centred: the app icon and the QR then start on one line, and
  // the leftover space collects in a single bottom-left corner. Centring the block
  // balances the column heights but strands an empty corner above the wordmark as
  // well as below it — two voids instead of one, and no shared line.
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
  // Icon beside the name, not stacked above it — the same shape as the TV hero,
  // and it hands ~85pt back to the content. Stacked, the identity block plus the
  // paragraph ate nearly half the first screenful before the first actionable row.
  phoneHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginBottom: 24,
  },
  phoneAppIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  phoneTitle: {
    fontSize: 40,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -1.6,
  },
  version: {
    fontSize: IS_TV ? 24 : 15,
    fontWeight: "500",
    color: "#8E8E93",
    marginTop: IS_TV ? 6 : 4,
  },
  // The gap the removed section header used to supply. At the header's old 12,
  // the card butted straight onto the last line of the paragraph.
  phoneProse: {
    marginBottom: 28,
  },
  // Uncapped, the left column runs ~1160pt, which at 36pt puts nearly 65
  // characters on a line — far enough that the eye loses its place walking back
  // to the next one. 820 lands near 45, and the extra lines also carry the block
  // further down against the full-height QR rail opposite.
  tvProse: {
    maxWidth: 820,
  },

  // Setup guide. The card, its gradient and the circular white frame are gone:
  // the QR is the content, and a circle clips the quiet zone the code needs on
  // all four sides.
  qrBlock: {
    alignItems: "center",
  },
  // The column is laid out space-between, so all its slack collects under the
  // caption — at 20 the URL sat further from the code it labels than from the
  // card beneath it, and read as that card's header. Tightening here binds the
  // caption upward and hands the difference to the gap below, without taking
  // points off the code itself.
  qrFrame: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 8,
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
