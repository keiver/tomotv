import { AmbientBackground } from "@/components/ambient-background";
import { FeatureProse } from "@/components/feature-prose";
import { HelpRow } from "@/components/help-row";
import { HelpTopic } from "@/components/help-topic";
import { settingsStyles } from "@/components/settings/styles";
import { DOCS_HOST, DOCS_URL, HELP_LEDE, HELP_STRINGS, HELP_TOPICS, ISSUES_HOST, ISSUES_URL } from "@/constants/help-copy";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

// The setup guide QR. It only renders inside an opened row, so it no longer has to
// share the screen with anything: 500pt puts ~390pt of actual code up, near the
// quarter of a 1920pt canvas the 10:1 rule wants for a 2m couch. The asset carries
// its own white margin, comfortably the four modules ISO 18004 asks for, so the
// frame adds no padding of its own.
const QR_SIZE = 500;

// Topics the platform can't have. Top Shelf is an Apple TV home-screen row.
const TOPICS = HELP_TOPICS.filter((topic) => !topic.tvOnly || IS_TV);

// Resolves to the running binary's CFBundleShortVersionString, not to app.json —
// a device holding an older build reports that older build, which is what an About
// screen should say. buildNumber is deliberately left off: app.json pins it at "1",
// which says nothing true about an installed binary.
const VERSION = Constants.expoConfig?.version;

// The three facts every About screen in this category states. Max calls the section
// "Info", Kodi calls it "System Information", Plex folds it into "Acknowledgements".
// Here it is also the line you need when filing the issue the row below it opens.
// Device model is left out: expo-constants deprecated it in favour of expo-device,
// and it returns null often enough not to build a line on.
const OS_LINE = `${IS_TV ? "tvOS" : "iOS"} ${Platform.Version}`;

const openDocs = () => Linking.openURL(DOCS_URL);
const openIssues = () => Linking.openURL(ISSUES_URL);

/**
 * Help — a list of the questions this app actually generates, each opening its
 * answer in place.
 *
 * It used to be an About screen wearing a Help name: a wall of feature badges and
 * a QR, answering nothing. Surveying the category (Infuse, Swiftfin, Plex, VLC,
 * Netflix, Max, Kodi) turned up no client that lists its features inside the
 * running app — features live in the store listing — and every one of them
 * presents informational content as focusable rows rather than as a poster. That
 * is also the only shape tvOS can scroll: the focus engine moves the viewport to
 * reach a focusable, so a screen of plain text is a screen the remote cannot read
 * past. One column on both platforms, the same shape Settings and the
 * Acknowledgements screen already use.
 */
export default function HelpScreen() {
  const router = useRouter();
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  const openLicenses = useCallback(() => router.push("/licenses"), [router]);
  const toggleTopic = useCallback((id: string) => setOpenTopic((current) => (current === id ? null : id)), []);
  const toggleSetup = useCallback(() => setSetupOpen((open) => !open), []);

  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />

      <ScrollView
        style={settingsStyles.scrollView}
        contentContainerStyle={settingsStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        // Without this the scroll view itself takes remote presses before the rows
        // inside it ever see them.
        focusable={false}>
        {/* No hasTVPreferredFocus anywhere below. tvOS only lets focus leave a
            ScrollView upward while contentOffset.y is exactly 0 (see the note in
            settings.tsx), and claiming focus for a row makes the engine scroll to
            reveal it — which would strand the user, unable to get back to the tab
            bar. Arriving on the tab, focus stays on the tab bar until Down. */}
        <View style={settingsStyles.contentContainer}>
          <View style={styles.hero}>
            <Image source={require("@/assets/brand/tomo-tv.png")} style={styles.appIcon} accessible={true} accessibilityRole="image" accessibilityLabel={`${HELP_STRINGS.appName} app icon`} />
            <View style={styles.heroText}>
              <Text style={styles.title}>{HELP_STRINGS.appName}</Text>
              <Text style={styles.version}>{VERSION ? `Version ${VERSION} · ${OS_LINE}` : OS_LINE}</Text>
            </View>
          </View>

          {/* One sentence, not the old eight-clause tour. What the app is belongs
              at the top of its own Help screen; the rest of the feature list was
              the store listing's job and is gone. */}
          <FeatureProse clauses={HELP_LEDE} style={styles.lede} />

          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{HELP_STRINGS.troubleshootingHeader}</Text>
          </View>
          <View style={settingsStyles.section}>
            {TOPICS.map((topic, index) => (
              <HelpTopic
                key={topic.id}
                icon={topic.icon}
                title={topic.question}
                answer={topic.answer}
                expanded={openTopic === topic.id}
                onToggle={() => toggleTopic(topic.id)}
                isFirst={index === 0}
                isLast={index === TOPICS.length - 1}
              />
            ))}
          </View>

          {/* No header over this one. The three rows name themselves, and "MORE"
              over them was a label with nothing in it. */}
          <View style={[settingsStyles.section, styles.tailSection]}>
            {/* TV has no browser to hand a URL to, so the guide arrives by camera:
                the code opens in place, at the moment you reach for your phone,
                rather than sitting on screen permanently. On iPhone you are already
                holding the thing that would scan it, so the row just opens the page. */}
            {IS_TV ? (
              <HelpTopic icon="book-outline" title={HELP_STRINGS.setupGuide} expanded={setupOpen} onToggle={toggleSetup} isFirst>
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
                </View>
              </HelpTopic>
            ) : (
              <HelpRow icon="book-outline" title={HELP_STRINGS.setupGuide} subtitle={DOCS_HOST} onPress={openDocs} accessory="external" isFirst />
            )}

            {IS_TV ? (
              <HelpRow icon="bug-outline" title={HELP_STRINGS.reportIssue} subtitle={ISSUES_HOST} accessory="none" />
            ) : (
              <HelpRow icon="bug-outline" title={HELP_STRINGS.reportIssue} subtitle={ISSUES_HOST} onPress={openIssues} accessory="external" />
            )}

            <HelpRow icon="ribbon-outline" title={HELP_STRINGS.acknowledgements} onPress={openLicenses} accessory="chevron" isLast />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Icon beside the name rather than stacked above it: the identity block is the
  // smallest thing on a Help screen, not the headline.
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 28 : 18,
    paddingHorizontal: IS_TV ? 16 : 8,
    marginBottom: IS_TV ? 28 : 20,
  },
  heroText: {
    flexShrink: 1,
  },
  // No glow: a 40pt amber halo on an app icon is a decoration nothing else in the
  // app uses.
  appIcon: {
    width: IS_TV ? 96 : 64,
    height: IS_TV ? 96 : 64,
    borderRadius: IS_TV ? 48 : 32,
  },
  title: {
    fontSize: IS_TV ? 56 : 34,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: IS_TV ? -1.6 : -1.2,
  },
  version: {
    fontSize: IS_TV ? 24 : 15,
    fontWeight: "500",
    color: "#8E8E93",
    marginTop: IS_TV ? 6 : 4,
  },
  lede: {
    paddingHorizontal: IS_TV ? 16 : 8,
    marginBottom: IS_TV ? 8 : 4,
  },

  // Replaces the gap a section header would have supplied above it.
  tailSection: {
    marginTop: IS_TV ? 28 : 22,
  },

  qrBlock: {
    alignItems: "center",
    paddingTop: 12,
  },
  qrFrame: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 12,
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
});
