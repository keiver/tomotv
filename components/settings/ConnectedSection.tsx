import { GLYPH_SIZE } from "@/components/settings/LeadingTile";
import { ListRow } from "@/components/settings/ListRow";
import { SERVER_GLYPH } from "@/components/settings/ServerRow";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { View } from "react-native";
import { settingsStyles } from "./styles";

interface ConnectedSectionProps {
  serverUrl: string;
  userName?: string;
  /** Opens the pushed server list (switch destination, add one, or sign out from there). */
  onSwitchServer: () => void;
  /** Further rows for this card, e.g. SyncPlay. The last one closes the card. */
  children?: React.ReactNode;
}

/**
 * The connected server as one row: the green mark says connected, the chevron says this is
 * also the way to another. It rests neutral so gold keeps meaning "chosen from these" in the
 * lists that offer a choice, and focus stays unmistakable on a television. The account
 * disambiguates multi-user servers, where per-user rows look broken if the app and the web
 * client are signed in as different people.
 */
export function ConnectedSection({ serverUrl, userName, onSwitchServer, children }: ConnectedSectionProps) {
  return (
    <View style={settingsStyles.section}>
      <ListRow
        // Green at rest is the connected mark; on the gold focus fill it takes the bar's ink
        // like every other glyph, so it never sits green on gold.
        icon={({ color }) => <Ionicons name={SERVER_GLYPH} size={GLYPH_SIZE} color={color === COLORS.ACCENT ? COLORS.SUCCESS : color} />}
        title={userName || "Connected"}
        subtitle={serverUrl || undefined}
        trailingIcon="chevron-forward"
        onPress={onSwitchServer}
        accessibilityLabel={`Switch server. Signed in as ${userName || "this account"}${serverUrl ? ` on ${serverUrl}` : ""}`}
        isFirst
        isLast={!children}
      />
      {children}
    </View>
  );
}
