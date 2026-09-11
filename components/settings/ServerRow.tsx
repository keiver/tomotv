import { glyphSize } from "@/components/settings/LeadingTile";
import { ListRow } from "@/components/settings/ListRow";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import { forwardRef } from "react";
import { View } from "react-native";

type ServerRowVariant = "add" | "server" | "scan";

/** The machine the media lives on, drawn as the monitor it usually has. */
export const SERVER_GLYPH: keyof typeof Ionicons.glyphMap = "desktop";

const ICONS: Record<ServerRowVariant, keyof typeof Ionicons.glyphMap> = {
  add: "add-circle",
  server: SERVER_GLYPH,
  scan: "wifi",
};

interface ServerRowProps {
  variant: ServerRowVariant;
  /** Row label (server name, or the CTA label for the add variant). */
  name: string;
  /** Secondary line under the label (server URL, scan progress, this device's IP). */
  subtitle?: string;
  onPress: () => void;
  onLongPress?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  /** Marks a server the scan just found that is not in the saved list. */
  isNew?: boolean;
  /** Wears the gold at rest: the touch stand-in for focus on the row a scan found. */
  selected?: boolean;
  /** The server the app is signed into right now: its glyph goes green, as on the Settings tab. */
  connected?: boolean;
  hasTVPreferredFocus?: boolean;
  /**
   * tvOS focus arrival. Only used by rows at the ends of a capped, internally-scrolling list,
   * which pin the scroll offset so focus can leave it — see NotConnectedSection.
   */
  onFocus?: () => void;
}

/**
 * ServerRow - the server-destination flavor of ListRow. Used for the add CTA, the network
 * scan, and each saved or discovered server. Forwards its ref to the row for requestTVFocus.
 */
export const ServerRow = forwardRef<View, ServerRowProps>(function ServerRow(
  { variant, name, subtitle, onPress, onLongPress, isLoading = false, disabled = false, isNew = false, selected = false, connected = false, hasTVPreferredFocus = false, onFocus }: ServerRowProps,
  ref,
) {
  // Only the scan row is stoppable. Discovered and saved rows also spin while
  // they connect, and offering to cancel those would be a lie.
  const stoppable = variant === "scan" && isLoading;
  // The leading glyph carries the action: a spinner alone reads as "wait", so
  // while a scan runs the row's own icon becomes the stop it already performs.
  const iconName = stoppable ? "close-circle" : ICONS[variant];

  return (
    <ListRow
      ref={ref}
      // Green at rest is the connected mark; on the gold fill it takes the bar's ink like every glyph.
      icon={connected ? ({ color }) => <Ionicons name={iconName} size={glyphSize(iconName)} color={color === COLORS.ACCENT ? COLORS.SUCCESS : color} /> : iconName}
      title={name}
      subtitle={subtitle}
      subtitleAccent={isNew ? "New · " : undefined}
      // A saved server pushes its login step, so it points; the rest act in place.
      trailingIcon={variant === "server" ? "chevron-forward" : undefined}
      isLoading={isLoading}
      selected={selected}
      onPress={onPress}
      onLongPress={onLongPress}
      onFocus={onFocus}
      // Pressability follows `disabled` alone. `isLoading` only drives the spinner,
      // so a row that doubles as a stop control (the network scan) stays selectable
      // while it works. Rows that must not be pressed twice already set `disabled`.
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityLabel={[name, isNew ? "new server" : undefined, connected ? "connected" : undefined, subtitle].filter(Boolean).join(", ")}
      accessibilityHint={stoppable ? "Stops the network scan" : undefined}
      accessibilityState={{ disabled, busy: isLoading, selected }}
    />
  );
});
