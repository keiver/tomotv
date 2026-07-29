import { useAuth } from "@/contexts/AuthContext";
import { NativeTabs } from "expo-router/unstable-native-tabs";

// SDK 56: Icon/Label moved under NativeTabs.Trigger.
const { Icon, Label } = NativeTabs.Trigger;

// Triggers must be static: flipping a trigger's `hidden` at runtime drops the route from the
// navigator and remounts everything, and on tvOS the remounted screens render with a stale,
// inset frame (visible border space around the content until the app is relaunched). Search is
// `disabled` instead while logged out — that only flips the native item's selectability, no
// restructuring. It also guarantees the native search view never mounts while the Search screen
// is on screen (that mid-view mount comes up with no search field).
export default function TabLayout() {
  const { isConnected } = useAuth();

  return (
    <NativeTabs blurEffect="systemChromeMaterial">
      <NativeTabs.Trigger name="(library)">
        <Icon sf="film.fill" />
        <Label>Library</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="search" disabled={!isConnected}>
        <Icon sf="magnifyingglass" />
        <Label>Search</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <Icon sf="gearshape.fill" />
        <Label>Settings</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="help">
        <Icon sf="questionmark.circle.fill" />
        <Label>Help</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
