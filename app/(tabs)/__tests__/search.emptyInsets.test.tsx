/** Search's empty, searching and error states centre under the field, in the safe area, not on the whole screen. */
import React from "react";
import { StyleSheet, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import SearchScreen from "../search";

jest.mock("expo-tvos-search", () => ({ isNativeSearchAvailable: () => false, TvosSearchView: () => null }));
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({}), useFocusEffect: jest.fn() }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isConnected: true, isReady: true }) }));
jest.mock("@/contexts/LibraryContext", () => ({ useLibrary: () => ({ isLoading: false }) }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({}) }));
jest.mock("@/hooks/use-color-scheme", () => ({ useColorScheme: () => "dark" }));
jest.mock("@/hooks/useItemLongPress", () => ({ useItemLongPress: () => jest.fn() }));
jest.mock("@/hooks/useOpenShelfItem", () => ({ useOpenShelfItem: () => jest.fn() }));
jest.mock("@/services/jellyfinApi", () => ({
  searchVideos: jest.fn(),
  searchLiveTv: jest.fn(async () => []),
  warmLiveTvSearch: jest.fn(async () => {}),
  connectToDemoServer: jest.fn(),
  subscribeLiveTvSearchIndex: () => () => {},
}));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key, locale: () => "en", subscribeLocale: () => () => {} }));
jest.mock("@/utils/logger", () => ({ logger: { debug: jest.fn(), error: jest.fn() } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 86, bottom: 20 }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/loading-row", () => ({ LoadingRow: () => null }));
jest.mock("@/components/search-loading-bar", () => ({ SearchLoadingBar: () => null }));
jest.mock("@/components/settings/ServerConnectScreen", () => ({ ServerConnectScreen: () => null }));
jest.mock("@/components/sunken-text-input", () => ({ SunkenTextInput: require("react").forwardRef(() => null) }));
jest.mock("@/components/search-results-grid", () => ({ SearchResultsGrid: require("react").forwardRef(() => null) }));

it("pads the empty state's region by each side's inset, so it centres under the field", async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<SearchScreen />);
  });
  const styles = tree.root.findAllByType(View).map((node) => StyleSheet.flatten(node.props.style));
  const region = styles.find((style) => style?.flex === 1 && style?.paddingRight === 86);
  expect(region).toMatchObject({ paddingLeft: 0, paddingRight: 86 });
  act(() => tree.unmount());
});
