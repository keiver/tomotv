import React, { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

interface LoadingActions {
  showGlobalLoader: () => void;
  hideGlobalLoader: () => void;
}

interface LoadingContextType extends LoadingActions {
  isLoading: boolean;
}

// Two contexts: the actions object never changes identity, so the components that only
// trigger the loader (every card-press navigation path) don't re-render when it shows or
// hides — those flips land exactly at transition start, the worst moment for a render sweep.
// `isLoading` lives only in the legacy full context; the overlay itself renders in the provider.
const LoadingActionsContext = createContext<LoadingActions | undefined>(undefined);
const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(false);

  const showGlobalLoader = useCallback(() => {
    setIsLoading(true);
  }, []);

  const hideGlobalLoader = useCallback(() => {
    setIsLoading(false);
  }, []);

  const actions = useMemo(() => ({ showGlobalLoader, hideGlobalLoader }), [showGlobalLoader, hideGlobalLoader]);
  const value = useMemo(() => ({ showGlobalLoader, hideGlobalLoader, isLoading }), [showGlobalLoader, hideGlobalLoader, isLoading]);

  return (
    <LoadingActionsContext.Provider value={actions}>
      <LoadingContext.Provider value={value}>
        {children}
        {/* Using absolute View instead of Modal to avoid tvOS focus corruption.
            Modal creates a new native view hierarchy which can break focus traversal
            when it unmounts on tvOS. */}
        {isLoading && (
          <View style={styles.globalLoader} pointerEvents="auto">
            <ActivityIndicator size="small" color="#FFFFFF" />
          </View>
        )}
      </LoadingContext.Provider>
    </LoadingActionsContext.Provider>
  );
}

export function useLoading() {
  const context = useContext(LoadingContext);
  if (context === undefined) {
    throw new Error("useLoading must be used within a LoadingProvider");
  }
  return context;
}

/** Show/hide only — stable identity, so consumers never re-render on loader visibility. */
export function useLoadingActions() {
  const context = useContext(LoadingActionsContext);
  if (context === undefined) {
    throw new Error("useLoadingActions must be used within a LoadingProvider");
  }
  return context;
}

const styles = StyleSheet.create({
  globalLoader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
});
