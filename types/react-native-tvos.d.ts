// Side-effect import keeps this file a module so the declare block augments
// react-native instead of replacing its types.
import "react-native";

declare module "react-native" {
  interface TouchableOpacityProps {
    isTVSelectable?: boolean;
    hasTVPreferredFocus?: boolean;
  }

  /**
   * TVEventControl provides methods for managing TV-specific event handling.
   * These methods are only available in react-native-tvos.
   */
  interface TVEventControlStatic {
    /**
     * Disables gesture handler cancel touches behavior.
     * Call this when a text input or search field gains focus to prevent
     * gesture handlers from interfering with keyboard input on tvOS.
     */
    disableGestureHandlersCancelTouches?: () => void;

    /**
     * Enables gesture handler cancel touches behavior.
     * Call this when a text input or search field loses focus to restore
     * normal gesture handler behavior on tvOS.
     */
    enableGestureHandlersCancelTouches?: () => void;
  }

  export const TVEventControl: TVEventControlStatic;
}
