/** Root routes a tab press never closes: popping them ends playback. */
const PLAYBACK_ROUTES = new Set(["player", "audio-player"]);

/**
 * Whether a tab press pops the root stack back to the tabs. The Mac tab bar sits in the window's
 * title bar, so it stays clickable over root routes and would otherwise switch tabs underneath them.
 */
export function shouldUnwindToTabs(routes: readonly { name: string }[]): boolean {
  const tabs = routes.findIndex((route) => route.name === "(tabs)");
  return tabs >= 0 && tabs < routes.length - 1 && !routes.some((route) => PLAYBACK_ROUTES.has(route.name));
}
