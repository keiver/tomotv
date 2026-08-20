import { COLORS } from "@/constants/colors";
import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FocusableButton } from "./FocusableButton";
import { logger } from "@/utils/logger";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error("ErrorBoundary caught an error", error, {
      component: "ErrorBoundary",
      componentStack: errorInfo.componentStack,
    });

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  handleReload = () => {
    // In a real app, you might want to reload the app or navigate to home
    // For now, just reset the error state
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <View style={styles.container}>
          <View style={styles.content}>
            <Ionicons name="alert-circle" size={Platform.isTV ? 80 : 64} color={COLORS.DESTRUCTIVE} />

            <Text style={styles.title}>Something Went Wrong</Text>

            <Text style={styles.message}>The app encountered an unexpected error. Please try again.</Text>

            {__DEV__ && this.state.error && (
              <View style={styles.debugContainer}>
                <Text style={styles.debugTitle}>Debug Info:</Text>
                <Text style={styles.debugText} numberOfLines={5}>
                  {this.state.error.toString()}
                </Text>
              </View>
            )}

            <FocusableButton title="Try Again" variant="primary" onPress={this.handleRetry} hasTVPreferredFocus={true} style={{ marginTop: Platform.isTV ? 48 : 32 }} />

            <FocusableButton title="Reload App" variant="secondary" onPress={this.handleReload} style={{ marginTop: Platform.isTV ? 20 : 16 }} />
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.SURFACE_NEUTRAL,
    justifyContent: "center",
    alignItems: "center",
    padding: Platform.isTV ? 60 : 40,
  },
  content: {
    maxWidth: Platform.isTV ? 800 : 400,
    width: "100%",
    alignItems: "center",
  },
  title: {
    marginTop: Platform.isTV ? 32 : 24,
    fontSize: Platform.isTV ? 36 : 28,
    fontWeight: "700",
    color: COLORS.TEXT_PRIMARY,
    textAlign: "center",
  },
  message: {
    marginTop: Platform.isTV ? 20 : 16,
    fontSize: Platform.isTV ? 22 : 18,
    fontWeight: "400",
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
    lineHeight: Platform.isTV ? 32 : 26,
    paddingHorizontal: Platform.isTV ? 40 : 20,
  },
  debugContainer: {
    marginTop: Platform.isTV ? 32 : 24,
    padding: Platform.isTV ? 20 : 16,
    backgroundColor: "rgba(255, 59, 48, 0.1)",
    borderRadius: Platform.isTV ? 16 : 12,
    borderWidth: 1,
    borderColor: "rgba(255, 59, 48, 0.3)",
    width: "100%",
  },
  debugTitle: {
    fontSize: Platform.isTV ? 18 : 14,
    fontWeight: "600",
    color: COLORS.DESTRUCTIVE,
    marginBottom: Platform.isTV ? 12 : 8,
  },
  debugText: {
    fontSize: Platform.isTV ? 16 : 12,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    color: COLORS.TEXT_SECONDARY,
    lineHeight: Platform.isTV ? 22 : 18,
  },
});
