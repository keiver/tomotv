import { Stack } from "expo-router";
import React from "react";

// Nested Stack for the Home tab. Drilling into a folder pushes a real route ([folderId]). Folder
// screens intercept the Apple TV Menu key (LibraryGrid's useFocusEffect: rewind-to-top before pop);
// everywhere else — root, Filters, player — the Menu button pops the stack natively.
// LibraryFiltersProvider lives at the app root (app/_layout.tsx) so the root Filters route shares it.
export const unstable_settings = {
  initialRouteName: "index",
};

export default function LibraryStackLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#3d3d3d" } }} />;
}
