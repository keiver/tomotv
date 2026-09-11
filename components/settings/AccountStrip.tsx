import { AccountAvatar } from "@/components/settings/AccountAvatar";
import { COLORS } from "@/constants/colors";
import { settingsStyles } from "@/components/settings/styles";
import { useCallback, useRef } from "react";
import { Platform, ScrollView, StyleSheet } from "react-native";

/** One saved sign-in in the strip. */
export interface StripPerson {
  key: string;
  label: string;
  sublabel?: string;
  imageUri?: string;
  connected: boolean;
  lastUsedAt: number;
  onPress: () => void;
}

interface AccountStripProps {
  people: StripPerson[];
  disabled?: boolean;
}

/** The people who can continue without a login, the sunken band at the foot of the server list. */
export function AccountStrip({ people, disabled = false }: AccountStripProps) {
  // tvOS lets focus leave a scroll view only at its matching end; see NotConnectedSection.
  const listRef = useRef<ScrollView>(null);
  const pinToStart = useCallback(() => listRef.current?.scrollTo({ x: 0, animated: false }), []);
  const pinToEnd = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);

  return (
    <ScrollView ref={listRef} horizontal showsHorizontalScrollIndicator={false} style={styles.band} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" focusable={false}>
      {people.map((person, index) => (
        <AccountAvatar
          key={person.key}
          label={person.label}
          sublabel={person.sublabel}
          uri={person.imageUri}
          connected={person.connected}
          onPress={person.onPress}
          disabled={disabled}
          onFocus={index === 0 ? pinToStart : index === people.length - 1 ? pinToEnd : undefined}
        />
      ))}
    </ScrollView>
  );
}

const STRIP_INSET = Platform.isTV ? 25 : 13;

const styles = StyleSheet.create({
  // The card runs out into the band, which re-paints the bottom lip it covers. Painted on the
  // strip itself: an overlay above the avatars would occlude their focus on tvOS.
  band: {
    backgroundColor: COLORS.SURFACE_SUNKEN,
    boxShadow: settingsStyles.rowShadowBottom.boxShadow,
  },
  content: {
    // One inset on the leading and vertical sides: the first cell hugs the band's corner.
    paddingLeft: STRIP_INSET,
    paddingRight: settingsStyles.listItem.paddingHorizontal,
    paddingVertical: STRIP_INSET,
    gap: Platform.isTV ? 16 : 4,
  },
});
