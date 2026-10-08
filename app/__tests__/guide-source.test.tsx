import GuideSourceScreen from "@/app/guide-source";
import { ListRow } from "@/components/settings/ListRow";
import { Clipboard } from "react-native";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockUrl = "https://guide.example.test/listings.xml.gz?region=en&days=7";
const mockPreferences = { guideUrls: [mockUrl], guideSourcesOff: [] };
const mockStatuses = {};
const mockTunerData = { tvgUrlSources: {} };

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ url: mockUrl }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/settings/SectionFooter", () => ({ SectionFooter: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => mockPreferences }));
jest.mock("@/services/externalGuide", () => ({
  subscribeGuideSources: () => () => {},
  guideSourceStatuses: () => mockStatuses,
  forgetGuide: jest.fn(),
  preloadGuide: jest.fn(),
}));
jest.mock("@/services/guideFileCache", () => ({ guideFileInfo: () => null }));
jest.mock("@/services/jellyfin/tunerGroups", () => ({
  lastKnownTunerData: () => mockTunerData,
  fetchTunerData: jest.fn(async () => mockTunerData),
}));
jest.mock("@/services/liveTvPreferences", () => ({ removeGuideUrl: jest.fn(), setGuideSourceEnabled: jest.fn() }));
jest.mock("@/utils/logger", () => ({ logger: { warn: jest.fn() } }));
jest.mock("expo-clipboard", () => {
  throw new Error("Copy must not depend on an on-demand clipboard module");
});

describe("Guide URL copy on iOS", () => {
  let tree: TestRenderer.ReactTestRenderer;
  let copy: jest.SpyInstance;

  beforeEach(async () => {
    jest.useFakeTimers();
    copy = jest.spyOn(Clipboard, "setString").mockImplementation(() => {});
    await act(async () => {
      tree = TestRenderer.create(<GuideSourceScreen />);
    });
  });

  afterEach(() => {
    act(() => tree.unmount());
    copy.mockRestore();
    jest.useRealTimers();
  });

  const urlRow = () => tree.root.findAllByType(ListRow).find((node) => node.props.subtitle === mockUrl)!;
  const pressCopy = () => urlRow().findByProps({ accessibilityRole: "button" }).props.onPress();

  it("copies the entire URL and immediately confirms the tap without loading expo-clipboard", () => {
    expect(urlRow().props.title).toBe("Guide URL");
    act(pressCopy);
    expect(copy).toHaveBeenCalledWith(mockUrl);
    expect(urlRow().props.title).toBe("Copied");
    expect(urlRow().props.trailingIcon).toBe("checkmark");

    act(() => jest.advanceTimersByTime(1500));
    expect(urlRow().props.title).toBe("Guide URL");
    expect(urlRow().props.trailingIcon).toBe("copy-outline");
  });

  it("keeps the confirmation visible after a second tap", () => {
    act(pressCopy);
    act(() => jest.advanceTimersByTime(1000));
    act(pressCopy);
    act(() => jest.advanceTimersByTime(500));
    expect(copy).toHaveBeenCalledTimes(2);
    expect(urlRow().props.title).toBe("Copied");

    act(() => jest.advanceTimersByTime(1000));
    expect(urlRow().props.title).toBe("Guide URL");
  });
});
