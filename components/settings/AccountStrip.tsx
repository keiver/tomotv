import { AccountAvatar } from "@/components/settings/AccountAvatar";
import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { PEOPLE_PANEL_WIDTH, STRIP_INSET, settingsStyles } from "@/components/settings/styles";
import React, { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { Platform, ScrollView, StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

/** One saved sign-in in the strip. */
export interface StripPerson {
  key: string;
  /** The saved server this sign-in lives on, for filtering by the focused row. */
  serverKey: string;
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
  /** tvOS focus arriving on or leaving a person (by key), for the section to know focus is within. */
  onFocusWithin?: (key: string) => void;
  onBlurWithin?: (key: string) => void;
}

export interface AccountStripHandle {
  scrollToStart: () => void;
}

/**
 * The people who can continue without a login. Phone: the sunken band at the foot of the
 * server list. TV: a gold column on the card's right, so a focused row reads as leading into it,
 * and people fade in and out as the focused row filters them.
 */
export const AccountStrip = forwardRef<AccountStripHandle, AccountStripProps>(function AccountStrip({ people, disabled = false, onFocusWithin, onBlurWithin }, ref) {
  // tvOS lets focus leave a scroll view only at its matching end; see NotConnectedSection.
  const listRef = useRef<ScrollView>(null);
  const pinToStart = useCallback(() => listRef.current?.scrollTo({ x: 0, y: 0, animated: false }), []);
  const pinToEnd = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);
  useImperativeHandle(ref, () => ({ scrollToStart: () => listRef.current?.scrollTo({ x: 0, y: 0, animated: true }) }), []);
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
      {people.map((person, index) => {
        const pin = index === 0 ? pinToStart : index === people.length - 1 ? pinToEnd : undefined;
        const avatar = (
          <AccountAvatar
            label={person.label}
            sublabel={person.sublabel}
            uri={person.imageUri}
            connected={person.connected}
            loading={person.loading}
            onGold={IS_TV}
            onPress={person.onPress}
            disabled={disabled}
            onFocus={() => {
              pin?.();
              onFocusWithin?.(person.key);
            }}
            onBlur={onBlurWithin && (() => onBlurWithin(person.key))}
          />
        );
        return IS_TV ? (
          <Animated.View key={person.key} entering={ARRIVE} exiting={LEAVE} layout={SHIFT}>
            {avatar}
          </Animated.View>
        ) : (
          <React.Fragment key={person.key}>{avatar}</React.Fragment>
        );
      })}
    </ScrollView>
  );

  return list;
});

const IS_TV = Platform.isTV;
const ARRIVE = FadeIn.duration(180);
const LEAVE = FadeOut.duration(120);
const SHIFT = LinearTransition.duration(220);

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
