// Polyfill structuredClone for older Node versions
// Standard Web API - proper polyfill pattern
if (typeof global.structuredClone === "undefined") {
  global.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

// WORKAROUND: Mock Expo's winter runtime globals for Jest
// Expo 54+ uses a "winter" module system that requires these globals
// This is a temporary hack until Expo provides official Jest support
// See: https://github.com/expo/expo/tree/main/packages/expo/src/winter
global.__ExpoImportMetaRegistry = {};

// Mock @expo/metro-runtime to prevent native runtime from loading in Node
jest.mock("@expo/metro-runtime", () => ({}));

// Mock expo-secure-store
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// Mock expo-constants so the reported app version is deterministic in tests
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: { version: "9.9.9" },
  },
}));

// Mock react-native-reanimated: importing the real one boots react-native-worklets,
// whose native half cannot initialize under Node, so any suite that transitively
// pulls in an animated component fails to load. Its own shipped mock is no help —
// react-native-reanimated/mock re-requires the real src/index and boots worklets
// on the way in. Hand-rolled, covering exactly what the app imports; animated
// values resolve to their target immediately, which is what a non-visual test
// wants anyway.
jest.mock("react-native-reanimated", () => {
  const React = require("react");
  const { View, Text, ScrollView, Image } = require("react-native");

  const passthrough = (toValue) => toValue;
  const easingFn = () => (t) => t;
  const easingCurve = { in: easingFn, out: easingFn, inOut: easingFn };

  const Animated = { View, Text, ScrollView, Image, createAnimatedComponent: (c) => c };

  return {
    __esModule: true,
    default: Animated,
    ...Animated,
    useSharedValue: (init) => ({ value: init }),
    useAnimatedStyle: (fn) => fn(),
    useReducedMotion: () => false,
    runOnJS:
      (fn) =>
      (...args) =>
        fn(...args),
    cancelAnimation: () => {},
    withTiming: passthrough,
    withDelay: (_delay, animation) => animation,
    withRepeat: passthrough,
    withSequence: (...animations) => animations[animations.length - 1],
    Easing: { ...easingCurve, linear: easingFn(), ease: easingFn(), quad: easingFn(), cubic: easingFn(), bezier: () => easingFn() },
  };
});

// Mock react-native-safe-area-context: components read insets directly via the
// hook; tests render without a SafeAreaProvider, which otherwise throws.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }) => children,
}));

// Mock react-native-video
jest.mock("react-native-video", () => {
  const React = require("react");
  return React.forwardRef((props, ref) => {
    return null; // Mock Video component
  });
});

// Mock expo-router to prevent loading app structure
jest.mock("expo-router", () => ({
  Stack: "Stack",
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  })),
  useLocalSearchParams: jest.fn(() => ({})),
  useFocusEffect: jest.fn(),
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  },
}));

// Mock InteractionManager - must happen before React Native imports
jest.doMock("react-native/Libraries/Interaction/InteractionManager", () => ({
  runAfterInteractions: jest.fn((callback) => {
    // Execute callback immediately in tests
    if (callback) callback();
    return { cancel: jest.fn() };
  }),
  createInteractionHandle: jest.fn(),
  clearInteractionHandle: jest.fn(),
}));

// Reset the app-global request cache between tests so cached reads never bleed across cases.
const { clearRequestCache } = require("@/services/requestCache");
beforeEach(() => {
  clearRequestCache();
});

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
