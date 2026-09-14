import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import React from "react";
import { StyleSheet, Text } from "react-native";

const PLACEHOLDER = "{library}";

/** The Filters panel's scope line. Splits on the placeholder so each language places the name itself. */
export function FiltersScope({ libraryName }: { libraryName: string }) {
  const [before, after = ""] = t("filters.scope").split(PLACEHOLDER);

  return (
    <Text style={styles.scope}>
      {before}
      <Text style={styles.library}>{libraryName}</Text>
      {after}
    </Text>
  );
}

const styles = StyleSheet.create({
  scope: {
    fontSize: 24,
    fontWeight: "500",
    color: COLORS.TEXT_TERTIARY,
    marginTop: 6,
  },
  library: {
    color: COLORS.TEXT_PRIMARY,
  },
});
