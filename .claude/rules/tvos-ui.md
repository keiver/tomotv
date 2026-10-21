---
paths:
  - "app/**/*.{ts,tsx}"
  - "components/**/*.{ts,tsx}"
---

# Screens and components

- No new dependency, icon family or font for a cosmetic change. Ionicons only.
- Stacked buttons share one width; hierarchy comes from fill/outline. Positional anchors (progress bars, badges) never move between states.
- No scale animations on grid items.
- Reanimated worklet helpers are not hoisted: define them above their callers.
