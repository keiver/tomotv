import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform } from "react-native";

// SDK 56: Icon/Label moved under NativeTabs.Trigger.
const { Icon, Label } = NativeTabs.Trigger;

// Repeated selection of the ALREADY-SELECTED tab runs react-native-screens' "special effects":
// pop the tab's stack to root, else scroll its list to top (RNSScreenStack.mm
// onRepeatedTabSelectionOfTabScreenController). UIKit's own iOS 26 pop-to-root is separately
// blocked by the library, so this is the only thing that pops.
//
// On tvOS that is destructive rather than helpful: moving focus UP to the tab bar counts as
// selecting the focused tab, so leaving a folder grid via Up threw the user back to the libraries
// root (and, with only popToRoot off, would instead jump the grid to the top). The Library tab is
// the one tab with a nested Stack, so it is the only one that needs this; the effect is a no-op
// wherever a tab holds a single screen.
//
// Constant per build, never flipped at runtime, so it does not trip the static-trigger rule below.
// Phone keeps the standard iOS tap-the-selected-tab affordance.
const DISABLE_TAB_RESELECT_EFFECTS = Platform.isTV;

// Triggers must be fully static. Flipping a trigger's `hidden` at runtime drops the route from
// the navigator and remounts everything — on tvOS the remounted screens render with a stale,
// inset frame (border space around the content until relaunch). Flipping `disabled` is no better:
// tvOS selects the tab via focus first, then ejects back to the previous tab. The Search screen
// handles the logged-out state itself (it mirrors the Library tab's disconnected view).
// Solid bar, so page content simply disappears behind it instead of showing through and colliding
// with the labels. Three props are required together, and each one is load-bearing:
//
// - blurEffect="none" maps to RNSBlurEffectStyleNone -> std::nullopt -> a nil UIBlurEffect, which
//   leaves tabBarAppearance.backgroundEffect unset (RNSConversions-Tabs.mm:9-15, 82-84). Any
//   material value here keeps the bar translucent no matter what colour is set behind it.
// - backgroundColor paints the bar itself (RNSTabBarAppearanceCoordinator.mm:154-156). #141414 is
//   the ambient canvas base, so the bar reads as the page's own top edge rather than a grey slab.
// - disableTransparentOnScrollEdge makes the two appearances match. UIKit uses standardAppearance
//   once content scrolls under the bar and scrollEdgeAppearance while the scroll view sits at its
//   edge; without this flag expo-router builds the edge one fully transparent (blurEffect 'none',
//   backgroundColor null, shadowColor transparent — build/native-tabs/appearance.ios.js:38-52), and
//   at rest is exactly when content sits under the bar with nothing behind it.
//
// This is the UITabBarAppearance opaque recipe (Apple's configureWithOpaqueBackground + a colour on
// BOTH appearances); react-native-screens exposes it as nil backgroundEffect + opaque colour. It
// replaces a gradient overlay that faked the same effect and that the tvOS focus engine reads as
// occlusion. Applies on tvOS: the coordinator assigns both appearances unguarded by TARGET_OS_TV.
export default function TabLayout() {
  return (
    <NativeTabs blurEffect="none" backgroundColor="#141414" disableTransparentOnScrollEdge>
      <NativeTabs.Trigger name="(library)" disablePopToTop={DISABLE_TAB_RESELECT_EFFECTS} disableScrollToTop={DISABLE_TAB_RESELECT_EFFECTS}>
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
