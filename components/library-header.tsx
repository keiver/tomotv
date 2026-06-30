import { FolderStackEntry } from "@/types/jellyfin";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface LibraryHeaderProps {
  /** Current folder navigation stack. Empty = library root (header renders nothing). */
  stack: FolderStackEntry[];
  /** Go up one folder level. Wired to the touch back row; on TV the Menu/back key handles it. */
  onBack: () => void;
}

/**
 * Folder context header for the Library tab. Replaces the old in-grid "Back card" and the
 * rotated left-edge breadcrumb.
 *
 * - TV (tvOS/Android TV): a non-focusable path so the user knows where they are. There is NO
 *   on-screen back control — going up is the remote's Menu/back button, which pops the nested
 *   navigation Stack natively.
 * - Touch (iOS/Android phone): a tappable "‹ CurrentFolder" row, since touch has no back key.
 */
function LibraryHeaderComponent({ stack, onBack }: LibraryHeaderProps) {
  if (stack.length === 0) {
    return null;
  }

  const current = stack[stack.length - 1];

  if (IS_TV) {
    return (
      <View style={styles.tvContainer} pointerEvents="none">
        {stack.map((entry, index) => {
          const isLast = index === stack.length - 1;
          return (
            <View key={entry.id} style={styles.pathSegment}>
              <Text style={[styles.tvPathText, isLast && styles.tvPathTextCurrent]} numberOfLines={1}>
                {entry.name}
              </Text>
              {!isLast && <Ionicons name="chevron-forward" size={22} color="#FFC312" style={styles.pathSeparator} />}
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onBack}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      accessibilityHint={`Return to ${stack.length > 1 ? stack[stack.length - 2].name : "Libraries"}`}
      style={({ pressed }) => [styles.touchBackRow, pressed && styles.touchBackRowPressed]}>
      <Ionicons name="chevron-back" size={26} color="#FFC312" />
      <Text style={styles.touchBackText} numberOfLines={1}>
        {current.name}
      </Text>
    </Pressable>
  );
}

export const LibraryHeader = React.memo(LibraryHeaderComponent);

const styles = StyleSheet.create({
  // --- TV: non-focusable path ---
  tvContainer: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginLeft: 16,
    marginBottom: 4,
  },
  pathSegment: {
    flexDirection: "row",
    alignItems: "center",
  },
  tvPathText: {
    color: "#98989D",
    fontSize: 28,
    fontWeight: "700",
    maxWidth: 360,
  },
  tvPathTextCurrent: {
    color: "#FFFFFF",
  },
  pathSeparator: {
    marginHorizontal: 8,
  },
  // --- Touch: tappable back row ---
  touchBackRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginLeft: 4,
    marginBottom: 2,
    paddingVertical: 6,
    paddingRight: 12,
  },
  touchBackRowPressed: {
    opacity: 0.6,
  },
  touchBackText: {
    marginLeft: 2,
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    maxWidth: 280,
  },
});
