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

// The bar's background, and the one thing that decides whether it is glass. react-native-screens
// exposes no UIGlassEffect: blurEffect maps only to UIBlurEffectStyle, so no string asks for Liquid
// Glass. On OS 26 UIKit already draws the bar as glass, and the appearance only ever takes that
// away — RNSTabsScreenComponentView.mm:84,284 starts from [UITabBarAppearance new] (Apple's
// configureWithDefaultBackground), and "systemDefault" is the single blurEffect value the
// coordinator steps over instead of assigning (RNSTabBarAppearanceCoordinator.mm:164-166). Any
// material value, or any backgroundColor, paints over the glass, so the glass branch passes neither.
//
// Below 26 that same default resolves to the legacy translucent blur — blurEffect
// "systemChromeMaterial" in everything but name, which is what 696abec removed: grid content rides
// up through the bar and collides with the labels. Those systems keep the opaque recipe (Apple's
// configureWithOpaqueBackground, expressed here as a nil backgroundEffect plus an opaque colour on
// both appearances). blurEffect "none" -> RNSBlurEffectStyleNone -> std::nullopt -> nil UIBlurEffect
// (RNSConversions-Tabs.mm:9-15, 82-84), and #141414 is the ambient canvas base, so the bar reads as
// the page's own top edge rather than a grey slab. Neither branch fakes anything with a gradient
// overlay: the tvOS focus engine reads those as occlusion.
//
// Platform.Version is the OS version string on both iOS and tvOS (Platform.ios.js:19-21), read once
// at module scope. Constant per launch, so it never flips a mounted appearance.
const SUPPORTS_LIQUID_GLASS = Number.parseInt(String(Platform.Version), 10) >= 26;
const TAB_BAR_BACKGROUND = SUPPORTS_LIQUID_GLASS ? ({ blurEffect: "systemDefault" } as const) : ({ blurEffect: "none", backgroundColor: "#141414" } as const);

// Triggers must be fully static. Flipping a trigger's `hidden` at runtime drops the route from
// the navigator and remounts everything — on tvOS the remounted screens render with a stale,
// inset frame (border space around the content until relaunch). Flipping `disabled` is no better:
// tvOS selects the tab via focus first, then ejects back to the previous tab. The Search screen
// handles the logged-out state itself (it mirrors the Library tab's disconnected view).
//
// disableTransparentOnScrollEdge is load-bearing in BOTH background branches, and it is the prop
// that makes the two appearances match. UIKit uses standardAppearance once content scrolls under
// the bar and scrollEdgeAppearance while the scroll view sits at its edge; without this flag
// expo-router hardcodes the edge one fully transparent (blurEffect 'none', backgroundColor null,
// shadowColor transparent — build/native-tabs/appearance.ios.js:38-52). On 26 that nils the
// backgroundEffect UIKit was drawing the glass with, below 26 it drops the opaque fill, and at rest
// is exactly when content sits under the bar with nothing behind it.
//
// Both appearances apply on tvOS: the coordinator assigns them unguarded by TARGET_OS_TV.
export default function TabLayout() {
  return (
    <NativeTabs {...TAB_BAR_BACKGROUND} disableTransparentOnScrollEdge>
      <NativeTabs.Trigger name="(library)" disablePopToTop={DISABLE_TAB_RESELECT_EFFECTS} disableScrollToTop={DISABLE_TAB_RESELECT_EFFECTS}>
        <Icon sf="house.fill" />
        <Label>Home</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="search">
        <Icon sf="magnifyingglass" />
        <Label>Search</Label>
      </NativeTabs.Trigger>

      {/* Help was a fourth tab here. No client in the category ships one — Infuse, Plex, Max and
          Kodi all keep about/info inside Settings, Netflix buries help behind the profile menu, and
          Apple's own tab-bar guidance lists content destinations, not About. The identity details
          it carried now live on the Settings screen; the license texts it linked to are reachable
          from there too. */}
      <NativeTabs.Trigger name="settings">
        <Icon sf="gearshape.fill" />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
