import { FocusableButton } from "@/components/FocusableButton";
import { COLORS } from "@/constants/colors";
import React, { forwardRef, useCallback, useMemo, useState } from "react";
import { NativeSyntheticEvent, StyleSheet, TargetedEvent, View } from "react-native";

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
export const ProgressButton = forwardRef<View, ProgressButtonProps>(function ProgressButton({ progress, style, onFocus, onBlur, accessibilityValue, ...rest }, ref) {
  const [focused, setFocused] = useState(false);

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
    if (percent <= 0) return undefined;
    const stop = Math.max(percent, MIN_STOP);
    const watched = focused ? COLORS.ACCENT_FOCUSED : COLORS.ACCENT;
    const remaining = focused ? COLORS.ACCENT_DIM_FOCUSED : COLORS.ACCENT_DIM;
    return {
      experimental_backgroundImage: `linear-gradient(90deg, ${watched} 0%, ${watched} ${stop}%, ${remaining} ${stop}%, ${remaining} 100%)`,
    };
  }, [percent, focused]);

  return (
    <FocusableButton
      ref={ref}
      {...rest}
      style={fillStyle ? StyleSheet.flatten([style, fillStyle]) : style}
      onFocus={handleFocus}
      onBlur={handleBlur}
      accessibilityValue={accessibilityValue ?? (percent > 0 ? { min: 0, max: 100, now: percent, text: `${percent}% watched` } : undefined)}
    />
  );
});
