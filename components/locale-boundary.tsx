import { useLocale } from "@/hooks/useLocale";
import React, { Fragment, type ComponentType, type ReactNode } from "react";

/**
 * Remounts a screen's content when the language changes, so every string is read again,
 * memoized ones included. Screens only: a navigator remounted on tvOS keeps stale native frames.
 */
export function LocaleBoundary({ children }: { children: ReactNode }) {
  return <Fragment key={useLocale()}>{children}</Fragment>;
}

/** A tab screen behind the boundary; NativeTabs takes no screenLayout to put it there. */
export function localeScreen<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  function LocaleScreen(props: P) {
    return (
      <LocaleBoundary>
        <Screen {...props} />
      </LocaleBoundary>
    );
  }
  LocaleScreen.displayName = `LocaleScreen(${Screen.displayName ?? Screen.name})`;
  return LocaleScreen;
}
