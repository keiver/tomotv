import { useAuthSession } from "@/hooks/useAuthSession";
import { loadThemes, type SavedThemes, subscribeThemes, ThemesUnavailableError, upsertTheme } from "@/services/themeLibrary";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";

export type SavedThemesState = SavedThemes & { status: "loading" | "ready" | "failed" };

const EMPTY: SavedThemesState = { themes: [], pending: [], status: "loading" };

/** The viewer's own themes, read again when the screen comes back into view and after every save or delete. */
export function useSavedThemes(): SavedThemesState {
  const session = useAuthSession();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ session: number; value: SavedThemesState }>({ session: -1, value: EMPTY });

  useEffect(() => subscribeThemes(() => setRevision((n) => n + 1)), []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadThemes()
        .then((saved) => {
          if (!cancelled) setState({ session, value: { ...saved, status: "ready" } });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setState((prev) => {
            const last = prev.session === session ? prev.value : EMPTY;
            // The list could not be read: the themes this load uploaded join the server's, and waiting ones list over older copies.
            if (!(error instanceof ThemesUnavailableError)) return { session, value: { ...last, status: "failed" } };
            const themes = error.uploaded.reduce(upsertTheme, last.themes).filter((theme) => !error.pending.some((waiting) => waiting.id === theme.id));
            return { session, value: { themes, pending: error.pending, status: "failed" } };
          });
        });
      return () => {
        cancelled = true;
      };
      // revision re-reads after a save or delete settles.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, revision]),
  );

  return state.session === session ? state.value : EMPTY;
}
