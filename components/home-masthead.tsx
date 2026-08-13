import { APP_VERSION, BRAND_NAME } from "@/constants/app";
import { Image, Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/**
 * HomeMasthead — the heading block at the top of the Libraries root.
 *
 * Phone gets a brand line above the screen title: the app mark, the name, and the version
 * pushed to the far edge. It replaces a ghost wordmark set at 34pt, which sat a few points
 * off the title's own size and read as a second, broken title rather than as identity.
 *
 * Structure is what fixes that. The brand line is deliberately SMALLER than the title it
 * introduces — a masthead, the way every streaming home does it: mark and name at the top
 * edge, then the content's own heading beneath at full weight. Nothing here competes with
 * "Libraries", which is still the largest thing on the screen.
 *
 * Apple's HIG argues against putting a logo inside an app at all ("people seldom need to be
 * reminded which app they're using"), and this deliberately takes the streaming-app exception:
 * one instance, on the home root only, at 30pt, scrolling away with the list. It is not
 * repeated on any other screen.
 *
 * The version rides here because this is the only place the phone shows it — Settings carries
 * none. Set as a tag at the opposite edge: findable when looked for, silent otherwise.
 *
 * TV renders the title alone. The same identity is already down the left spine there
 * (components/brand-corners.tsx), which a phone has no band for.
 */
export function HomeMasthead({ title }: { title: string }) {
  return (
    <View style={styles.container}>
      {!IS_TV && (
        <View style={styles.brandRow}>
          {/* The wordmark beside it already says this, so the mark is decoration to a
              screen reader, not a second announcement of the same name. */}
          <Image source={require("@/assets/images/brand-mark.png")} style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <Text style={styles.wordmark} allowFontScaling={false}>
            {BRAND_NAME.toUpperCase()}
          </Text>
          {!!APP_VERSION && (
            <Text style={styles.version} allowFontScaling={false} accessibilityLabel={`Version ${APP_VERSION}`}>
              {APP_VERSION}
            </Text>
          )}
        </View>
      )}
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginLeft: IS_TV ? 16 : 12,
    marginRight: IS_TV ? 16 : 4,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    // Air below the brand line, not above it: the list already starts under the status bar
    // inset, and the gap is what keeps this from reading as one block with the title.
    marginBottom: 18,
    paddingRight: 8,
  },
  // The app icon at Spotlight-result size, corner-rounded so it reads as the icon rather than
  // as a coloured tile. Sourced from a 96px copy of assets/brand/tomo-tv.png — the 1024
  // original would decode a 4MB bitmap to paint 30 points.
  mark: {
    width: 30,
    height: 30,
    borderRadius: 8,
  },
  // Held under the title's white and well under its size: tracked-out caps at 15pt read as a
  // masthead, where the same name set large enough to rival "Libraries" read as a mistake.
  wordmark: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "rgba(255, 255, 255, 0.88)",
  },
  // Pushed to the far edge by the auto margin, at the grey the app uses for secondary text.
  version: {
    marginLeft: "auto",
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.4,
    color: "#8E8E93",
  },
  // Unchanged from the heading this block replaced, on both platforms.
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 4,
  },
});
