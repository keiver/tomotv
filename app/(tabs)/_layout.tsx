import { useAuth } from "@/contexts/AuthContext";
import { NativeTabs } from "expo-router/unstable-native-tabs";

// SDK 56: Icon/Label moved under NativeTabs.Trigger.
const { Icon, Label } = NativeTabs.Trigger;

export default function TabLayout() {
  const { isConnected, isReady } = useAuth();

  // Wait for the saved session to resolve before first paint so logged-in users don't get an
  // initial hidden→visible Search tab flash (which would remount the whole tab navigator).
  if (!isReady) return null;

  return (
    <NativeTabs blurEffect="systemChromeMaterial">
      <NativeTabs.Trigger name="(library)">
        <Icon sf="film.fill" />
        <Label>Library</Label>
      </NativeTabs.Trigger>

      {/* Search is only useful once connected; hidden when logged out. */}
      <NativeTabs.Trigger name="search" hidden={!isConnected}>
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
