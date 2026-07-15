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
