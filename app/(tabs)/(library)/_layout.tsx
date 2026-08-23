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
  // Phone folder screens carry a real UINavigationBar; tvOS draws its own bar inside the grid
  // (components/library-header.tsx) because a UINavigationBar under the top tab bar centres the
  // title over the artwork and its bar items never take remote focus.
  //
  // Transparent with NO blur: the back chevron and the bar items sit straight on the grid, with no
  // full-width slab behind them. headerTransparent resolves the background to "transparent"
  // (useHeaderConfigProps.js:159) and blurEffect defaults to "none", so nothing paints.
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
        headerShown: !Platform.isTV,
        headerTransparent: true,
        headerShadowVisible: false,
        headerTitleStyle: { color: COLORS.TEXT_PRIMARY },
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
