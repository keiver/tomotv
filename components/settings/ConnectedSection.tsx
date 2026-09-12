import { AvatarDisc } from "@/components/settings/AvatarDisc";
import { ListRow } from "@/components/settings/ListRow";
import { COLORS } from "@/constants/colors";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { POSTER_MARK_SIDE, settingsStyles } from "./styles";

const RING = Platform.isTV ? 3 : 2;
const RING_GAP = RING;
const DISC = POSTER_MARK_SIDE - 2 * (RING + RING_GAP);

interface ConnectedSectionProps {
  serverUrl: string;
  userName?: string;
  /** The signed-in user's picture on the server, over the generated face once it loads. */
  userImageUri?: string;
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
export function ConnectedSection({ serverUrl, userName, userImageUri, onSwitchServer, children }: ConnectedSectionProps) {
  return (
    <View style={settingsStyles.section}>
      <ListRow
        // The account's face in the strip's green ring; on the gold focus fill the ring takes
        // the bar's ink like every glyph, so it never sits green on gold.
        icon={({ color }) => (
          <View style={[styles.ring, { borderColor: color === COLORS.ACCENT ? COLORS.SUCCESS : color }]}>
            <AvatarDisc seed={userName || "Connected"} uri={userImageUri} size={DISC} />
          </View>
        )}
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

const styles = StyleSheet.create({
  ring: {
    width: POSTER_MARK_SIDE,
    height: POSTER_MARK_SIDE,
    borderRadius: POSTER_MARK_SIDE / 2,
    borderWidth: RING,
    padding: RING_GAP,
  },
});
