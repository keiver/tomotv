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
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#3d3d3d" } }} />;
}
