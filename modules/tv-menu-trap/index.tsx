import { requireNativeViewManager } from "expo-modules-core";
import React from "react";
import { Platform, type StyleProp, type ViewStyle } from "react-native";

interface TVMenuTrapProps {
  /** While true, a Menu press with focus inside this view is consumed and reported. */
  trapEnabled: boolean;
  onMenuPress: () => void;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

const NativeView = Platform.isTV ? requireNativeViewManager<TVMenuTrapProps>("TVMenuTrap") : null;

/** Off the TV it adds nothing to the tree. */
export function TVMenuTrap({ trapEnabled, onMenuPress, style, children }: TVMenuTrapProps) {
  if (!NativeView) return <>{children}</>;
  return (
    <NativeView trapEnabled={trapEnabled} onMenuPress={onMenuPress} style={style}>
      {children}
    </NativeView>
  );
}
