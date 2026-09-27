import { COLORS } from "@/constants/colors";
import { subscribeToast, type Toast } from "@/services/toast";
import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeInDown, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SHOW_MS = 2600;

/**
 * The toast pill, one at a time in the screen's upper right, 12% down from the top edge
 * (TVToast.swift holds the same spot on tvOS); the latest message replaces the current one.
 * Touch platforms only: services/toast.ts never emits on TV.
 */
export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<(Toast & { key: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeToast((next) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ ...next, key: Date.now() });
      timer.current = setTimeout(() => setToast(null), SHOW_MS);
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (Platform.isTV || !toast) return null;
  return (
    <View style={[styles.host, { paddingRight: insets.right + 16 }]} pointerEvents="none">
      <Animated.View
        key={toast.key}
        entering={FadeInDown.duration(220).easing(Easing.out(Easing.quad))}
        exiting={FadeOut.duration(260)}
        style={[styles.pill, toast.kind === "error" && styles.pillError]}>
        <Text style={styles.text} numberOfLines={2}>
          {toast.message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: "12%",
    left: 0,
    right: 0,
    alignItems: "flex-end",
    zIndex: 9998,
  },
  pill: {
    maxWidth: "82%",
    backgroundColor: COLORS.SURFACE_RAISED,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.BORDER_RESTING_ARGB,
  },
  pillError: {
    backgroundColor: COLORS.DESTRUCTIVE_DEEP,
  },
  text: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: 15,
    textAlign: "center",
  },
});
