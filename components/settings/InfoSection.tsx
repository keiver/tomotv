import { settingsStyles } from "@/components/settings/styles";
import { ReactNode } from "react";
import { View } from "react-native";

interface InfoSectionProps {
  children: ReactNode;
}

/**
 * A grouped-list card with nothing to press: the same sunken surface `settingsStyles.section`
 * gives the row lists, holding a stat instead of rows. The child owns its own inset, the way
 * a row does. Nothing inside takes focus, so on tvOS the remote passes over it.
 */
export function InfoSection({ children }: InfoSectionProps) {
  return <View style={settingsStyles.section}>{children}</View>;
}
