/** The Settings tab's loading row centres in the safe area, so iPhone Duo's side column never pushes it off centre. */
import SettingsScreen from "@/app/(tabs)/settings";
import React from "react";
import { StyleSheet, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 86, bottom: 20 }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: jest.fn() }));
// Never resolves, so the screen stays on its loading state.
jest.mock("expo-secure-store", () => ({ getItemAsync: () => new Promise(() => {}) }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/brand-corners", () => ({ BrandCorners: () => null }));
jest.mock("@/components/loading-row", () => ({ LoadingRow: () => null }));
jest.mock("@/components/settings/ServerConnectScreen", () => ({ ServerConnectScreen: () => null }));
jest.mock("@/services/jellyfinApi", () => ({
  getStoredUserName: jest.fn(async () => ""),
  getUserImageUrl: jest.fn(),
  isAuthenticated: () => true,
  isDemoMode: jest.fn(async () => false),
  subscribeAuthChange: () => () => {},
}));
jest.mock("@/services/syncPlayManager", () => ({ refreshAccess: jest.fn(async () => {}), subscribe: () => () => {} }));
jest.mock("@/services/diagnosticsInbox", () => ({ pokeInbox: jest.fn() }));

it("centres the loading row in the safe area", async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<SettingsScreen />);
  });
  const centred = tree.root
    .findAllByType(View)
    .map((node) => StyleSheet.flatten(node.props.style))
    .find((style) => style?.justifyContent === "center" && style?.alignItems === "center");
  expect(centred).toMatchObject({ paddingLeft: 0, paddingRight: 86 });
  act(() => tree.unmount());
});
