import { BUTTON_BORDER_WIDTH, FocusableButton } from "@/components/FocusableButton";
import { COLORS } from "@/constants/colors";
import React, { forwardRef, useCallback, useMemo, useState } from "react";
import { LayoutChangeEvent, NativeSyntheticEvent, StyleSheet, TargetedEvent, View } from "react-native";

// The pill's left cap curves over roughly its first eighth, so a smaller true fraction
// would cut inside the curve and show nothing. Same floor the card's bar carries.
const MIN_STOP = 6;

type FocusableButtonProps = React.ComponentProps<typeof FocusableButton>;

interface ProgressButtonProps extends FocusableButtonProps {
  /** Watched fraction (0-1). Absent or 0 renders the plain button. */
  progress?: number;
}

/**
 * A FocusableButton whose fill states how far into the video you are: bright gold up to the
 * watched fraction, muted gold past it, hard edge between. The two tones are a gradient on
 * the button's OWN background, not a layer behind it — tvOS magnifies the focused button,
 * and anything painted outside it would sit still while it grows.
 */
export const ProgressButton = forwardRef<View, ProgressButtonProps>(function ProgressButton({ progress, style, onFocus, onBlur, onLayout, accessibilityValue, ...rest }, ref) {
  const [focused, setFocused] = useState(false);
  // A background image is sized to the PADDING box and tiled across the border box, so the
  // pill's transparent border shows the gradient's far end wrapped into the near cap. Pin the
  // gradient to the border box instead; that needs the button's measured size.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setSize((current) => (current?.width === width && current?.height === height ? current : { width, height }));
      onLayout?.(event);
    },
    [onLayout],
  );

  const handleFocus = useCallback(
    (event: NativeSyntheticEvent<TargetedEvent>) => {
      setFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );

  const handleBlur = useCallback(
    (event: NativeSyntheticEvent<TargetedEvent>) => {
      setFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  const percent = progress != null ? Math.round(Math.min(progress, 1) * 100) : 0;

  const fillStyle = useMemo(() => {
    if (percent <= 0 || size == null) return undefined;
    const stop = Math.max(percent, MIN_STOP);
    const watched = focused ? COLORS.ACCENT_FOCUSED : COLORS.ACCENT;
    const remaining = focused ? COLORS.ACCENT_DIM_FOCUSED : COLORS.ACCENT_DIM;
    return {
      experimental_backgroundImage: `linear-gradient(90deg, ${watched} 0%, ${watched} ${stop}%, ${remaining} ${stop}%, ${remaining} 100%)`,
      experimental_backgroundSize: [{ x: size.width, y: size.height }],
      experimental_backgroundPosition: [{ top: -BUTTON_BORDER_WIDTH, left: -BUTTON_BORDER_WIDTH }],
      experimental_backgroundRepeat: [{ x: "no-repeat" as const, y: "no-repeat" as const }],
    };
  }, [percent, focused, size]);

  return (
    <FocusableButton
      ref={ref}
      {...rest}
      style={fillStyle ? StyleSheet.flatten([style, fillStyle]) : style}
      onLayout={handleLayout}
      onFocus={handleFocus}
      onBlur={handleBlur}
      accessibilityValue={accessibilityValue ?? (percent > 0 ? { min: 0, max: 100, now: percent, text: `${percent}% watched` } : undefined)}
    />
  );
});
