import { ListRow } from "@/components/settings/ListRow";
import { Ionicons } from "@expo/vector-icons";
import React from "react";

type ServerRowVariant = "add" | "server" | "demo" | "scan";

const ICONS: Record<ServerRowVariant, keyof typeof Ionicons.glyphMap> = {
  add: "add-circle-outline",
  server: "server-outline",
  demo: "server-outline",
  scan: "wifi-outline",
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
  hasTVPreferredFocus?: boolean;
  /**
   * tvOS focus arrival. Only used by rows at the ends of a capped, internally-scrolling list,
   * which pin the scroll offset so focus can leave it — see NotConnectedSection.
   */
  onFocus?: () => void;
}

/**
 * ServerRow - the server-destination flavor of ListRow, so server names read
 * in full. Used for the add CTA, the network scan, and each saved, discovered,
 * or demo server destination.
 */
export function ServerRow({ variant, name, subtitle, onPress, onLongPress, isLoading = false, disabled = false, isNew = false, hasTVPreferredFocus = false, onFocus }: ServerRowProps) {
  // Only the scan row is stoppable. Discovered and saved rows also spin while
  // they connect, and offering to cancel those would be a lie.
  const stoppable = variant === "scan" && isLoading;
  // The leading glyph carries the action: a spinner alone reads as "wait", so
  // while a scan runs the row's own icon becomes the stop it already performs.
  const iconName = stoppable ? "close-circle" : ICONS[variant];

  return (
    <ListRow
      icon={iconName}
      title={name}
      subtitle={subtitle}
      subtitleAccent={isNew ? "New · " : undefined}
      trailingIcon="chevron-forward"
      isLoading={isLoading}
      onPress={onPress}
      onLongPress={onLongPress}
      onFocus={onFocus}
      // Pressability follows `disabled` alone. `isLoading` only drives the spinner,
      // so a row that doubles as a stop control (the network scan) stays selectable
      // while it works. Rows that must not be pressed twice already set `disabled`.
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityLabel={[name, isNew ? "new server" : undefined, subtitle].filter(Boolean).join(", ")}
      accessibilityHint={stoppable ? "Stops the network scan" : undefined}
      accessibilityState={{ disabled, busy: isLoading }}
    />
  );
}
