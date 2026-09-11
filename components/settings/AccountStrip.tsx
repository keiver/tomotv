import { AccountAvatar } from "@/components/settings/AccountAvatar";
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

/** The people who can continue without a login, in a horizontal run over the server list. */
export function AccountStrip({ people, disabled = false }: AccountStripProps) {
  // tvOS lets focus leave a scroll view only at its matching end; see NotConnectedSection.
  const listRef = useRef<ScrollView>(null);
  const pinToStart = useCallback(() => listRef.current?.scrollTo({ x: 0, animated: false }), []);
  const pinToEnd = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);

  return (
    <ScrollView ref={listRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" focusable={false}>
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

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: settingsStyles.listItem.paddingHorizontal,
    paddingVertical: Platform.isTV ? 24 : 12,
    gap: Platform.isTV ? 16 : 4,
  },
});
