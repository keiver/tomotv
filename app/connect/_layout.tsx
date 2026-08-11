import { Stack } from "expo-router";
import React from "react";
import { Platform } from "react-native";

/**
 * Nested Stack for the login steps: Quick Connect, then username and password.
 *
 * These are real routes so the Apple TV Menu button pops them natively — ZERO menu
 * handlers, by law (memories/CLAUDE-lessons-learned.md, the e136575 Menu lesson and
 * the June 2026 tab-bar entry). As sections of a state machine inside one screen
 * they had no stack to pop, so the tab bar's focus engine claimed the press: Menu
 * moved focus to the tab bar, and a second press quit the app.
 *
 * The group sits at the ROOT, not inside (tabs), for the same reason player,
 * filters, photo-viewer and licenses do: a route under a tab leaves the native tab
 * bar on screen to swallow Menu. It also means one implementation serves all three
 * hosts of the server list (Settings, Library, Search).
 */
export const unstable_settings = {
  initialRouteName: "quick-connect",
};

export default function ConnectStackLayout() {
  // contentStyle matches the app canvas (#141414): the native screen's own
  // background shows during a push before the JS content paints. TV crossfades so
  // the step change reads as one surface; phone keeps the default push so the
  // interactive back-swipe and the transition agree.
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: Platform.isTV ? "fade" : "default",
        contentStyle: { backgroundColor: "#141414" },
      }}
    />
  );
}
