import { LinearGradient } from "expo-linear-gradient";
import { Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/**
 * Fades page content out beneath the top tab bar, so anything scrolled up meets
 * the bar as a gradient instead of colliding with its labels. The canvas colour
 * is opaque at the very top and clears before the scrim's bottom edge.
 *
 * DANGER, tvOS: this is an absolutely positioned view above the page, and the
 * focus engine treats a covering sibling as occlusion — react-native-tvos
 * hard-codes isUserInteractionEnabled = YES on plain Fabric views, so
 * pointerEvents="none" does NOT opt out (it only stops touches, which is why
 * phone never shows the bug). A focusable the scrim covers ENTIRELY becomes
 * unreachable; partial coverage is tolerated, which is why the library grid can
 * run this over the top sliver of its poster rows. Any screen adopting it must
 * keep its first focusable mostly clear of `height` — see the callers.
 */
export function TopScrim({ height, style }: { height?: number; style?: object }) {
  const insets = useSafeAreaInsets();
  // Sized for screens whose content starts at the top of the scroll view, so it
  // covers the bar plus a short fade without eating into the first card. A
  // screen that already clears the bar (the library grid pads its content to
  // insets.top + 100) can afford a longer fade and passes its own height.
  const resolved = height ?? insets.top + (IS_TV ? 120 : 96);

  return (
    <LinearGradient
      colors={IS_TV ? ["#141414", "#141414", "rgba(20, 20, 20, 0.55)", "transparent"] : ["rgba(20, 20, 20, 0.92)", "rgba(20, 20, 20, 0.55)", "transparent"]}
      locations={IS_TV ? [0, 0.35, 0.7, 1] : [0, 0.55, 1]}
      style={[styles.scrim, { height: resolved }, style]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
});
