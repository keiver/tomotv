import { AccountAvatar } from "@/components/settings/AccountAvatar";
import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { PEOPLE_PANEL_WIDTH, STRIP_INSET, settingsStyles } from "@/components/settings/styles";
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { t } from "@/services/i18n";

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
  /** Long press: the sign-in or forget menu for this account. */
  onLongPress?: () => void;
}

interface AccountStripProps {
  people: StripPerson[];
  disabled?: boolean;
  /** tvOS focus arriving on or leaving a person (by key), for the section to know focus is within. */
  onFocusWithin?: (key: string) => void;
  onBlurWithin?: (key: string) => void;
  /** tvOS: the row Left returns to from any person, the one that led into the column. */
  nextFocusLeft?: number;
}

export interface AccountStripHandle {
  scrollToStart: () => void;
}

/**
 * The people who can continue without a login. Phone: the sunken band at the foot of the
 * server list. TV: a gold column on the card's right, so a focused row reads as leading into it,
 * and people fade in and out as the focused row filters them.
 */
export const AccountStrip = forwardRef<AccountStripHandle, AccountStripProps>(function AccountStrip({ people, disabled = false, onFocusWithin, onBlurWithin, nextFocusLeft }, ref) {
  // tvOS lets focus leave a scroll view only at its matching end; see NotConnectedSection.
  const listRef = useRef<ScrollView>(null);
  const pinToStart = useCallback(() => listRef.current?.scrollTo({ x: 0, y: 0, animated: false }), []);
  const pinToEnd = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);
  useImperativeHandle(ref, () => ({ scrollToStart: () => listRef.current?.scrollTo({ x: 0, y: 0, animated: true }) }), []);
  // TV: the last person, for the guide in the empty panel under the column.
  const [lastNode, setLastNode] = useState<View | null>(null);
  const list = (
    <ScrollView
      ref={listRef}
      horizontal={!IS_TV}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      style={IS_TV ? styles.panelList : undefined}
      contentContainerStyle={IS_TV ? styles.panelContent : styles.content}
      keyboardShouldPersistTaps="handled"
      focusable={false}>
      {people.map((person, index) => {
        const pin = index === 0 ? pinToStart : index === people.length - 1 ? pinToEnd : undefined;
        const avatar = (
          <AccountAvatar
            ref={IS_TV && index === people.length - 1 ? setLastNode : undefined}
            nextFocusLeft={nextFocusLeft}
            label={person.label}
            sublabel={person.sublabel}
            uri={person.imageUri}
            connected={person.connected}
            loading={person.loading}
            onGold={IS_TV}
            onPress={person.onPress}
            onLongPress={person.onLongPress}
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

  // TV: a row level with a person reaches it by geometry. A row level with the empty panel under
  // the column (one person, a low row) would reach nothing, so that space is a guide to the last
  // person, the nearest one. Nothing sits over the people.
  return IS_TV ? (
    <View style={styles.panel}>
      {list}
      <TVFocusGuideView style={styles.panelFill} destinations={lastNode ? [lastNode] : undefined} />
    </View>
  ) : (
    <View style={styles.band}>
      {/* Heading for screen readers only: the band carries no visible title. */}
      <Text accessibilityRole="header" style={styles.srHeading}>
        {t("settings.users")}
      </Text>
      {list}
    </View>
  );
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
  srHeading: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
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
  // Sized to its people and no taller; the guide takes whatever is left.
  panelList: {
    flexGrow: 0,
    flexShrink: 1,
  },
  panelFill: {
    flex: 1,
  },
  panelContent: {
    padding: STRIP_INSET,
    gap: 16,
    alignItems: "center",
  },
});
