import { Stack } from "expo-router";
import React from "react";

// Nested Stack for the Home tab. Drilling into a folder pushes a real route ([folderId]). On
// Apple TV the Menu button pops this stack natively — ZERO menu handlers anywhere, by law:
// any handler dual-fires with the native delivery (see memories/CLAUDE-lessons-learned.md,
// e136575 Menu lesson and its August 2026 confirmations).
// LibraryFiltersProvider lives at the app root (app/_layout.tsx) so the root Filters route shares it.
export const unstable_settings = {
  initialRouteName: "index",
};

export default function LibraryStackLayout() {
  // contentStyle matches the app canvas (#141414): the native screen's own background shows during
  // a push before the JS content paints, and anything lighter flashes on the dark UI. Crossfade
  // instead of the default sideways push — folder drilling reads as one surface changing content,
  // not a new sheet sliding in (native-stack also supports fade_from_bottom / slide_from_* /
  // simple_push / flip / none; fade is the least intrusive that still marks the transition).
  return <Stack screenOptions={{ headerShown: false, animation: "fade", contentStyle: { backgroundColor: "#141414" } }} />;
}
