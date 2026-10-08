import { useCardPalette } from "@/hooks/useCardPalette";
import type { GuideDay } from "@/hooks/useGuide";
import { dayPickerRange, pickedDay } from "@/utils/guide";
import { DatePicker, Host, Popover, Rectangle } from "@expo/ui/swift-ui";
import { datePickerStyle, fixedSize, frame, opacity, padding, tint } from "@expo/ui/swift-ui/modifiers";
import React, { useCallback, useMemo } from "react";
import { StyleSheet } from "react-native";

/** The graphical date picker's fitting size. */
const CALENDAR_WIDTH = 320;
const CALENDAR_HEIGHT = 324;

interface GuideDayPickerProps {
  days: readonly GuideDay[];
  selectedMs: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (dayMs: number) => void;
}

/** Phone: the system calendar in a popover off the day strip it lies behind; days past the listings fall out of range. */
export function GuideDayPicker({ days, selectedMs, open, onOpenChange, onSelect }: GuideDayPickerProps) {
  const range = useMemo(() => dayPickerRange(days) ?? undefined, [days]);
  const selection = useMemo(() => new Date(selectedMs), [selectedMs]);
  const { accent } = useCardPalette();
  const handleChange = useCallback(
    (date: Date) => {
      const dayMs = pickedDay(days, date.getTime());
      if (dayMs === null) return;
      onSelect(dayMs);
      onOpenChange(false);
    },
    [days, onSelect, onOpenChange],
  );
  return (
    <Host style={StyleSheet.absoluteFill} pointerEvents="none" colorScheme="dark">
      {/* Hangs below the strip over the grid, the arrow on its top edge, clear of the header. */}
      <Popover isPresented={open} onIsPresentedChange={onOpenChange} attachmentAnchor="bottom" arrowEdge="top">
        <Popover.Trigger>
          <Rectangle modifiers={[opacity(0)]} />
        </Popover.Trigger>
        <Popover.Content>
          {/* The month's fitting size as a floor, then its ideal size: the popover sizes to the whole month. */}
          <DatePicker
            selection={selection}
            range={range}
            onDateChange={handleChange}
            modifiers={[datePickerStyle("graphical"), tint(accent), frame({ minWidth: CALENDAR_WIDTH, minHeight: CALENDAR_HEIGHT }), fixedSize(), padding()]}
          />
        </Popover.Content>
      </Popover>
    </Host>
  );
}
