import { Stack } from "expo-router";
import React from "react";

// Nested Stack for the Library tab. Drilling into a folder pushes a real route ([folderId]) so the
// Apple TV Menu button pops the stack NATIVELY — the platform-correct pattern (react-native-tvos
// discussion #493, Expo native-tabs docs). No custom menu handlers anywhere in this stack.
export const unstable_settings = {
  initialRouteName: "index",
};

export default function LibraryStackLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#3d3d3d" } }} />;
}
