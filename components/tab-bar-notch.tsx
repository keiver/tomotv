import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";

const IS_TV = Platform.isTV;

// The tab bar's own colour (backgroundColor on NativeTabs in app/(tabs)/_layout.tsx) and the
// AmbientBackground base, which is what makes the shape invisible at rest: it only reads as an
// edge where content is actually passing under it.
const BAR_COLOR = "#141414";
// Transparent, but in the band's own hue — plain "transparent" is rgba(0,0,0,0) and would ramp
// through black across the fillet's antialiased edge.
const CLEAR = "rgba(20, 20, 20, 0)";

// Fractions of the window, never points. tvOS reports 1920x1080 logical on every TV it drives, so
// today these resolve to fixed numbers, but the shape stays honest if that stops being true.
//
// Sized against the bar as it measures on an Apple TV 4K: the pill is centred, 560pt wide, and
// spans y 44-111 (library-grid.tsx's inset comment records the same bottom edge).
//
// The flat band is thin because it has to be. The pill starts 44pt down, and a band reaching past
// that line would have the pill's shoulders standing on top of it — the native bar paints above
// everything here — instead of hanging inside the notch. That one constraint fixes the shape: the
// protrusion then takes the reference's ~6:1 width-to-depth, and stops short of 157pt, the tvOS
// safe-area top inset where every screen already starts its content.
const FLAT_H = 0.024; // 26pt — full width, 18pt above the pill
const NOTCH_H = 0.13; // 140pt — 29pt below the pill, 17pt clear of the content line
const NOTCH_W = 0.38; // 730pt — 85pt clear of the pill on each side, so labels can grow
const BOTTOM_R = 0.04; // 43pt — the notch's own bottom corners
const FILLET_R = 0.0204; // 22pt — the concave joins back up to the band

/**
 * Radial gradient that fills a square everywhere EXCEPT a quarter disc at one corner: the concave
 * join between the band's bottom edge and the notch's side. A View can only round a corner outward,
 * and a hole cannot be punched with a border, so the wedge is painted instead — same
 * experimental_backgroundImage path AmbientBackground's glows use (RCTRadialGradient.mm), with the
 * ramp collapsed to 1% so it reads as an edge rather than a fade.
 *
 * `corner` is the disc's centre. Tangent to both straight edges by construction: the circle sits at
 * the square's corner with a radius of the square's side, so it meets the band's bottom edge and the
 * notch's side exactly once each.
 */
function filletFill(corner: { bottom: number; left: number } | { bottom: number; right: number }, radius: number) {
  return [
    {
      type: "radial-gradient" as const,
      shape: "circle" as const,
      size: { x: radius, y: radius },
      position: corner as never,
      colorStops: [
        { color: CLEAR, positions: ["0%"] },
        { color: CLEAR, positions: ["99%"] },
        { color: BAR_COLOR, positions: ["100%"] },
      ],
    },
  ];
}

/**
 * TabBarNotch — the app's top bezel: a solid band across the head of the screen with a notch
 * dropping around the floating tvOS tab bar, so scrolling content is cut off cleanly instead of
 * sliding up alongside the pill and colliding with its labels.
 *
 * tvOS only. The phone's tab bar is at the bottom and is a standard translucent UITabBar.
 *
 * CALLER CONSTRAINT: render this AFTER the screen's scrolling content — the exact opposite of
 * BrandCorners. Siblings paint in order and occlusion is the entire point here. That makes the
 * second half of the rule load-bearing: on tvOS a view drawn above a focusable also stops the focus
 * engine entering it, so nothing focusable may come to REST inside these frames. Every screen that
 * mounts this already pads its content past the notch (the tvOS safe-area top inset is 157pt, well
 * below the 127pt the notch reaches), so only scrolled-past content is ever underneath. The pieces
 * are separate siblings rather than one full-width container for the same reason: outside the
 * notch, only the top 45pt is covered.
 */
export function TabBarNotch() {
  const { width, height } = useWindowDimensions();

  if (!IS_TV) return null;

  const flat = height * FLAT_H;
  const depth = height * NOTCH_H;
  const notchWidth = width * NOTCH_W;
  const notchLeft = (width - notchWidth) / 2;
  const notchRight = notchLeft + notchWidth;
  const bottomRadius = height * BOTTOM_R;
  const fillet = height * FILLET_R;

  return (
    <>
      <View pointerEvents="none" style={[styles.piece, { left: 0, width: notchLeft, height: flat }]} />
      <View pointerEvents="none" style={[styles.piece, { left: notchRight, width: width - notchRight, height: flat }]} />
      <View
        pointerEvents="none"
        style={[
          styles.piece,
          {
            left: notchLeft,
            width: notchWidth,
            height: depth,
            borderBottomLeftRadius: bottomRadius,
            borderBottomRightRadius: bottomRadius,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[styles.fillet, { top: flat, left: notchLeft - fillet, width: fillet, height: fillet, experimental_backgroundImage: filletFill({ bottom: 0, left: 0 }, fillet) }]}
      />
      <View pointerEvents="none" style={[styles.fillet, { top: flat, left: notchRight, width: fillet, height: fillet, experimental_backgroundImage: filletFill({ bottom: 0, right: 0 }, fillet) }]} />
    </>
  );
}

const styles = StyleSheet.create({
  piece: {
    position: "absolute",
    top: 0,
    backgroundColor: BAR_COLOR,
  },
  // No backgroundColor: the gradient IS the fill, and a colour under it would square the corner off.
  fillet: {
    position: "absolute",
  },
});
