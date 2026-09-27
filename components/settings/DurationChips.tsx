import { GlassButton } from "@/components/glass-button";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;

interface DurationChipsProps<V extends number> {
  options: readonly { value: V; label: string }[];
  selected: V;
  onSelect: (value: V) => void;
}

/** One row of glass duration pills inside a section card; the chosen one wears the focus tint. */
export function DurationChips<V extends number>({ options, selected, onSelect }: DurationChipsProps<V>) {
  return (
    <View style={styles.row} collapsable={false}>
      {options.map((option) => {
        const isSelected = option.value === selected;
        return (
          <GlassButton
            key={option.value}
            title={option.label}
            selected={isSelected}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(option.value)}
            style={IS_TV ? undefined : styles.phonePill}
            textStyle={IS_TV ? undefined : styles.phoneText}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: IS_TV ? 12 : 4,
    paddingHorizontal: IS_TV ? 32 : 8,
    paddingVertical: IS_TV ? 28 : 14,
  },
  // The channel wall's phone pill metrics (ShowAllChannels).
  phonePill: {
    minHeight: 36,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  // The link variant's phone size; GlassButton's 22 is the TV pill scale.
  phoneText: {
    fontSize: 15,
  },
});
