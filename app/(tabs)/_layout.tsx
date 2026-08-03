import { NativeTabs } from "expo-router/unstable-native-tabs";

// SDK 56: Icon/Label moved under NativeTabs.Trigger.
const { Icon, Label } = NativeTabs.Trigger;

// Triggers must be fully static. Flipping a trigger's `hidden` at runtime drops the route from
// the navigator and remounts everything — on tvOS the remounted screens render with a stale,
// inset frame (border space around the content until relaunch). Flipping `disabled` is no better:
// tvOS selects the tab via focus first, then ejects back to the previous tab. The Search screen
// handles the logged-out state itself (it mirrors the Library tab's disconnected view).
export default function TabLayout() {
  return (
    <NativeTabs blurEffect="systemChromeMaterial">
      <NativeTabs.Trigger name="(library)">
        <Icon sf="house.fill" />
        <Label>Home</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="search">
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
