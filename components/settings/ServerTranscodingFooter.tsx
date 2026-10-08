/** The Server transcoding card's foot: what the server itself allows this account, in one sentence with its state inked. */
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { serverTranscodingFooter } from "@/components/settings/transcodingCopy";
import { COLORS } from "@/constants/colors";
import type { TranscodePermissions } from "@/services/jellyfin/transcodePermissions";
import { StyleSheet, Text } from "react-native";

export function ServerTranscodingFooter({ permissions }: { permissions: TranscodePermissions | null }) {
  const sentence = serverTranscodingFooter(permissions);
  if (!sentence) return null;
  return (
    <SectionFooter>
      <Text style={settingsStyles.sectionNote}>
        {sentence.before}
        <Text style={sentence.enabled ? styles.enabled : styles.disabled}>{sentence.state}</Text>
        {sentence.after}
      </Text>
    </SectionFooter>
  );
}

const styles = StyleSheet.create({
  enabled: {
    color: COLORS.SUCCESS,
  },
  // The softer red: the one that clears 4.5:1 on the sunken band (ListRow's destructive ink).
  disabled: {
    color: COLORS.DESTRUCTIVE_SOFT,
  },
});
