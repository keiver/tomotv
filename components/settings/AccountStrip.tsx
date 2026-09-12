import { AccountAvatar } from "@/components/settings/AccountAvatar";
import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { PEOPLE_PANEL_WIDTH, STRIP_INSET, settingsStyles } from "@/components/settings/styles";
import { useCallback, useRef } from "react";
import { Platform, ScrollView, StyleSheet } from "react-native";

/** One saved sign-in in the strip. */
export interface StripPerson {
  key: string;
  label: string;
  sublabel?: string;
  imageUri?: string;
  connected: boolean;
  /** This account is connecting: its ring turns. */
  loading: boolean;
  lastUsedAt: number;
  onPress: () => void;
}

interface AccountStripProps {
  people: StripPerson[];
  disabled?: boolean;
}

/**
 * The people who can continue without a login. Phone: the sunken band at the foot of the
 * server list. TV: a gold column on the card's right, so a focused row reads as leading into it.
 */
export function AccountStrip({ people, disabled = false }: AccountStripProps) {
  // tvOS lets focus leave a scroll view only at its matching end; see NotConnectedSection.
  const listRef = useRef<ScrollView>(null);
  const pinToStart = useCallback(() => listRef.current?.scrollTo({ x: 0, y: 0, animated: false }), []);
  const pinToEnd = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);

  const list = (
    <ScrollView
      ref={listRef}
      horizontal={!IS_TV}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      style={IS_TV ? styles.panel : styles.band}
      contentContainerStyle={IS_TV ? styles.panelContent : styles.content}
      keyboardShouldPersistTaps="handled"
      focusable={false}>
      {people.map((person, index) => (
        <AccountAvatar
          key={person.key}
          label={person.label}
          sublabel={person.sublabel}
          uri={person.imageUri}
          connected={person.connected}
          loading={person.loading}
          onGold={IS_TV}
          onPress={person.onPress}
          disabled={disabled}
          onFocus={index === 0 ? pinToStart : index === people.length - 1 ? pinToEnd : undefined}
        />
      ))}
    </ScrollView>
  );

  return list;
}

const IS_TV = Platform.isTV;

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
    gap: 4,
  },
  // The column sits beside the rows, never over them (sectionMain keeps them clear), and wears
  // the focused row's fill. No shadow of its own: the card's inset lips and rim paint over it.
  panel: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: PEOPLE_PANEL_WIDTH,
    backgroundColor: CARD_FOCUS.TITLE_BG_FOCUSED,
  },
  panelContent: {
    padding: STRIP_INSET,
    gap: 16,
    alignItems: "center",
  },
});
