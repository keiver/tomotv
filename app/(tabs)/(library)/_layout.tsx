import { COLORS } from "@/constants/colors";
import { Stack } from "expo-router";
import React from "react";
import { Platform } from "react-native";

// Nested Stack for the Home tab. Drilling into a folder pushes a real route ([folderId]). On
// Apple TV the Menu button pops this stack natively — ZERO menu handlers anywhere, by law:
// any handler dual-fires with the native delivery (see memories/CLAUDE-lessons-learned.md,
// e136575 Menu lesson and its August 2026 confirmations).
// LibraryFiltersProvider lives at the app root (app/_layout.tsx) so the root Filters route shares it.
export const unstable_settings = {
  initialRouteName: "index",
};

export default function LibraryStackLayout() {
  // The folder screens carry a real UINavigationBar. On TV it is the one control that never scrolls
  // away, which keeps focus inside the screen so Menu pops instead of falling to the tab bar.
  //
  // Translucent, so the grid scrolls under it. react-native-screens then leaves the screen full
  // bleed (edgesForExtendedLayout stays UIRectEdgeAll, RNSScreenStackHeaderConfig.mm:486) and UIKit's
  // own inset is what clears the bar — see contentInsetAdjustmentBehavior in library-grid.
  //
  // No headerTintColor: the root theme's `primary` is already the gold UIKit draws the back chevron
  // with, and setting the tint here would take the title colour with it.
  //
  // contentStyle matches the app canvas (#141414): the native screen's own background shows during
  // a push before the JS content paints, and anything lighter flashes on the dark UI. On TV the
  // crossfade makes folder drilling read as one surface changing content; on phone the interactive
  // back-swipe slides regardless of the animation, so the default sideways push keeps gesture and
  // transition consistent.
  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerBlurEffect: "systemChromeMaterialDark",
        headerShadowVisible: false,
        // tvOS has no large title: UINavigationItem.largeTitleDisplayMode is API_UNAVAILABLE(tvos).
        headerLargeTitleEnabled: !Platform.isTV,
        headerTitleStyle: { color: COLORS.TEXT_PRIMARY },
        headerLargeTitleStyle: { color: COLORS.TEXT_PRIMARY },
        animation: Platform.isTV ? "fade" : "default",
        contentStyle: { backgroundColor: COLORS.BACKGROUND },
      }}>
      {/* The libraries root stays full bleed — the tab bar already names it. The title still lands:
          react-native-screens assigns navitem.title before hiding the bar, so the first pushed
          folder's back button reads "Home". */}
      <Stack.Screen name="index" options={{ headerShown: false, title: "Home" }} />
    </Stack>
  );
}
