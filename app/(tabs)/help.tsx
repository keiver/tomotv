import { AmbientBackground } from "@/components/ambient-background";
import { FiltersGhostTitle } from "@/components/filters-ghost-title";
import { FocusableButton } from "@/components/FocusableButton";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Image, Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Phone tab bar height (mirrors library-grid.tsx); the scroll content must clear it.
const PHONE_TAB_BAR_HEIGHT = 49;

type IoniconName = keyof typeof Ionicons.glyphMap;

interface Feature {
  icon: IoniconName;
  label: string;
}

const features: Feature[] = [
  { icon: "flash", label: "On-Device Playback Engine" },
  { icon: "cloud-offline", label: "Zero Server Transcoding" },
  { icon: "headset", label: "Multi-Audio Tracks" },
  { icon: "text", label: "Subtitle Support" },
  { icon: "search-circle", label: "Native Search" },
  { icon: "play-skip-forward", label: "Up Next Queue" },
  { icon: "time", label: "Continue Watching" },
  { icon: "tv", label: "Top Shelf" },
  { icon: "options", label: "Library Filters" },
  { icon: "heart", label: "Favorites" },
  { icon: "images", label: "Photo Viewer" },
  { icon: "globe", label: "Auto Server Discovery" },
];

const DOCS_URL = "tomotv.app";

const openDocs = () => Linking.openURL(`https://${DOCS_URL}`);

// The engine truth, not marketing fluff: MKVs, legacy codecs and surround
// audio play on the device itself; the server just hands over the file.
const TAGLINE = "Plays nearly everything on your device. Your server never breaks a sweat.";

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const openLicenses = useCallback(() => router.push("/licenses"), [router]);

  // Phone: one scrollable editorial column. The clipped ghost wordmark is the same
  // signature the Filters panel uses; the QR is a companion for scanning from another
  // device — on this screen the guide opens with a tap, not a camera.
  if (!Platform.isTV) {
    return (
      <View style={styles.container}>
        <AmbientBackground baseColor="#0D0D0F" glows={{ top: "rgba(255, 195, 18, 0.06)", bottom: "rgba(52, 199, 89, 0.04)" }} />
        <FiltersGhostTitle name="Tomo TV" />

        <ScrollView
          contentContainerStyle={[
            styles.phoneScroll,
            { paddingTop: insets.top + 28, paddingBottom: PHONE_TAB_BAR_HEIGHT + insets.bottom + 28, paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right },
          ]}
          showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View>
            <View style={[styles.iconGlow, styles.phoneIconGlow]}>
              <Image source={require("@/assets/images/icon.png")} style={styles.phoneAppIcon} accessible={true} accessibilityRole="image" accessibilityLabel="Tomo TV app icon" />
            </View>
            <Text style={styles.phoneTitle}>Tomo TV</Text>
            <Text style={styles.phoneSubtitle}>{TAGLINE}</Text>
          </View>

          {/* Features — quiet two-column index, no chip chrome */}
          <View style={{ marginTop: 40, marginLeft: 6 }}>
            <Text style={styles.featuresEyebrow}>FEATURES</Text>
            <View style={styles.featureGrid}>
              {features.map((f) => (
                <View key={f.label} style={styles.featureCell}>
                  <Ionicons name={f.icon} size={18} color="#FFC312" />
                  <Text style={styles.featureLabel}>{f.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Setup — the page's one action, on the page grid like every other block (no card
              box: its inner padding was the one thing off the shared left line). No QR here:
              you can't scan the screen you're holding, so the URL itself is the way in. */}
          <View style={{ marginTop: 40 }}>
            <Text style={styles.qrEyebrow}>SETUP GUIDE</Text>
            <Text style={styles.setupHint}>Everything from first connection to subtitles, in one guide.</Text>

            <FocusableButton title={`Open ${DOCS_URL}`} variant="primary" onPress={openDocs} icon={<Ionicons name="open-outline" size={20} color="#000000" />} style={styles.setupButton} />
          </View>

          {/* Open-source attribution — the media engine ships FFmpeg and friends. */}
          <View style={{ marginTop: 40 }}>
            <Text style={styles.featuresEyebrow}>OPEN SOURCE</Text>
            <Text style={styles.setupHint}>Built on FFmpeg, GnuTLS, dav1d and other open-source projects.</Text>
            <FocusableButton title="Acknowledgements" variant="secondary" onPress={openLicenses} icon={<Ionicons name="ribbon-outline" size={20} color="#FFC312" />} style={styles.setupButton} />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AmbientBackground baseColor="#0D0D0F" glows={{ top: "rgba(255, 195, 18, 0.06)", bottom: "rgba(52, 199, 89, 0.04)" }} />

      <View style={styles.columns}>
        {/* Left Column */}
        <View style={styles.leftColumn}>
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.iconRow}>
              <View style={styles.iconGlow}>
                <Image source={require("@/assets/images/icon.png")} style={styles.appIcon} accessible={true} accessibilityRole="image" accessibilityLabel="Tomo TV app icon" />
              </View>
              <View style={styles.titleBlock}>
                <Text style={styles.title}>Tomo TV</Text>
                <Text style={styles.subtitle}>{TAGLINE}</Text>
              </View>
            </View>

            {/* Feature pills */}
            <View style={styles.pillsRow}>
              {features.map((f) => (
                <View key={f.label} style={styles.pill}>
                  <Ionicons name={f.icon} size={18} color="#FFC312" />
                  <Text style={styles.pillText}>{f.label}</Text>
                </View>
              ))}
            </View>

            {/* Open-source attribution — this screen's one focusable; reachable by
                swiping down from the tab bar. */}
            <View style={styles.openSourceBlock}>
              <Text style={styles.featuresEyebrow}>OPEN SOURCE</Text>
              <Text style={styles.openSourceLine}>Built on FFmpeg, GnuTLS, dav1d and other open-source projects.</Text>
              <FocusableButton
                title="Acknowledgements"
                variant="secondary"
                onPress={openLicenses}
                icon={<Ionicons name="ribbon-outline" size={22} color="#FFC312" />}
                style={styles.acknowledgementsButton}
              />
            </View>
          </View>
        </View>

        {/* Center - QR Card */}
        <View style={styles.centerColumn}>
          <View style={styles.qrCard}>
            <LinearGradient colors={["rgba(52,199,89,0.15)", "rgba(52,199,89,0.05)", "transparent"]} style={styles.qrGradient} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} />

            <Text style={styles.qrEyebrow}>SETUP GUIDE</Text>
            <Text style={styles.qrHint}>Scan to get started</Text>

            <View style={styles.qrFrame}>
              <Image
                source={require("@/assets/images/tomotv-qr-1000px.png")}
                style={styles.qrImage}
                accessible={true}
                accessibilityRole="image"
                accessibilityLabel={`QR code for the setup guide at ${DOCS_URL}`}
              />
            </View>

            <Text style={styles.qrUrl}>{DOCS_URL}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const TV = Platform.isTV;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Layout
  columns: {
    flex: 1,
    flexDirection: "row",
    paddingHorizontal: TV ? 100 : 48,
    paddingVertical: TV ? 80 : 48,
    gap: TV ? 80 : 40,
  },

  // Phone: single scrollable editorial column.
  phoneScroll: {
    paddingHorizontal: 20,
    gap: 28,
    margin: 30,
  },
  phoneIconGlow: {
    alignSelf: "flex-start",
    marginBottom: 16,
  },
  phoneAppIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  phoneTitle: {
    fontSize: 44,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -2,
    marginBottom: 6,
  },
  phoneSubtitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#98989D",
    lineHeight: 23,
    maxWidth: 300,
  },
  setupHint: {
    fontSize: 13,
    color: "#98989D",
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 16,
  },
  setupButton: {
    width: "100%",
    maxWidth: 320,
    alignSelf: "flex-start",
  },
  featuresEyebrow: {
    fontSize: 13,
    fontWeight: "600",
    color: "#8E8E93",
    letterSpacing: 1.5,
    marginBottom: 14,
  },
  featureGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 16,
  },
  featureCell: {
    width: "50%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 12,
  },
  featureLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#A1A1A6",
    flexShrink: 1,
  },

  // Left
  leftColumn: {
    flex: 1,
    justifyContent: "space-between",
  },
  // TV-only: positions the hero within the fixed two-column canvas. The top
  // margin shrank when the open-source block joined the column.
  hero: {
    marginTop: 120,
    marginLeft: 50,
  },
  openSourceBlock: {
    marginTop: TV ? 56 : 32,
  },
  openSourceLine: {
    fontSize: TV ? 18 : 13,
    color: "#98989D",
    lineHeight: TV ? 26 : 19,
    marginTop: 6,
    marginBottom: 16,
  },
  acknowledgementsButton: {
    alignSelf: "flex-start",
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: TV ? 28 : 18,
    marginBottom: TV ? 48 : 28,
  },
  iconGlow: {
    shadowColor: "#FFC312",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: TV ? 40 : 30,
  },
  appIcon: {
    width: TV ? 120 : 80,
    height: TV ? 120 : 80,
    borderRadius: TV ? 60 : 40,
  },
  titleBlock: {},
  title: {
    fontSize: TV ? 72 : 48,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -2,
    marginBottom: TV ? 4 : 2,
  },
  subtitle: {
    fontSize: TV ? 24 : 16,
    fontWeight: "500",
    color: "#98989D",
    lineHeight: TV ? 34 : 24,
  },

  // Feature pills
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: TV ? 12 : 8,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: TV ? 10 : 6,
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingVertical: TV ? 14 : 10,
    paddingHorizontal: TV ? 20 : 14,
    borderRadius: TV ? 50 : 30,
    borderWidth: 1,
    borderColor: "rgba(255, 195, 18, 0.4)",
  },
  pillText: {
    fontSize: TV ? 17 : 13,
    fontWeight: "600",
    color: "#A1A1A6",
  },
  jellyfinAccent: {
    color: "#34C759",
    fontWeight: "700",
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#A6BFA3",
  },

  // Center column - QR Card
  centerColumn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  qrCard: {
    width: TV ? 560 : 300,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: TV ? 44 : 28,
    alignItems: "center",
    justifyContent: "center",
    padding: TV ? 56 : 32,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  qrGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "60%",
  },
  qrEyebrow: {
    fontSize: TV ? 14 : 12,
    fontWeight: "700",
    color: "#34C759",
    letterSpacing: 3,
    marginBottom: TV ? 10 : 0,
    marginTop: TV ? 10 : 0,
  },
  qrFrame: {
    backgroundColor: "#FFFFFF",
    padding: TV ? 24 : 14,
    borderRadius: 90000,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.6,
    shadowRadius: 40,
    marginBottom: TV ? 32 : 18,
    marginTop: 20,
    overflow: "hidden",
  },
  qrImage: {
    width: TV ? 280 : 150,
    height: TV ? 280 : 150,
  },
  qrUrl: {
    fontSize: TV ? 24 : 15,
    fontWeight: "800",
    color: "#4B99FF",
    marginBottom: TV ? 10 : 6,
  },
  qrHint: {
    fontSize: TV ? 16 : 11,
    color: "#98989D",
    fontWeight: "500",
  },
});
