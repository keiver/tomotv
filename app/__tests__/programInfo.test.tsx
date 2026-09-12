import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { cancelTimer, createSeriesTimer, createTimer, fetchProgram, fetchTimerDefaults, fetchTimers } from "@/services/jellyfinApi";
import ProgramInfoScreen from "@/app/program-info";

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ programId: "p1", channelId: "c1", channelName: "One" }),
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
}));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn(), hideGlobalLoader: jest.fn() }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/glass-surface", () => ({ GlassSurface: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/loading-row", () => ({ LoadingRow: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/components/FocusableButton", () => ({
  FocusableButton: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => {
    const { Text } = require("react-native");
    return <Text testID={`button:${title}`} onPress={disabled ? undefined : onPress} />;
  },
}));
jest.mock("@/services/jellyfinApi", () => ({
  fetchProgram: jest.fn(),
  fetchTimers: jest.fn(),
  fetchTimerDefaults: jest.fn(),
  createTimer: jest.fn(),
  createSeriesTimer: jest.fn(),
  cancelTimer: jest.fn(),
  cancelSeriesTimer: jest.fn(),
}));

const now = Date.now();
const airing = {
  Id: "p1",
  Name: "Football Live",
  ChannelId: "c1",
  ChannelName: "One",
  StartDate: new Date(now - 10 * 60_000).toISOString(),
  EndDate: new Date(now + 50 * 60_000).toISOString(),
  IsSeries: true,
  IsSports: true,
};
const later = { ...airing, StartDate: new Date(now + 60 * 60_000).toISOString(), EndDate: new Date(now + 120 * 60_000).toISOString() };

async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount() {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<ProgramInfoScreen />);
  });
  await settle();
  return tree!;
}

const buttons = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll((node) => typeof node.type === "string" && typeof node.props.testID === "string" && node.props.testID.startsWith("button:"))
    .map((node) => node.props.testID.slice("button:".length));
const press = async (tree: TestRenderer.ReactTestRenderer, title: string) => {
  await act(async () => {
    tree.root.findByProps({ testID: `button:${title}` }).props.onPress();
  });
  await settle();
};

describe("ProgramInfoScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchTimerDefaults as jest.Mock).mockResolvedValue({ ProgramId: "p1", Name: "Football Live" });
    (createTimer as jest.Mock).mockResolvedValue(undefined);
    (createSeriesTimer as jest.Mock).mockResolvedValue(undefined);
    (cancelTimer as jest.Mock).mockResolvedValue(undefined);
  });

  it("offers Watch, Record and Record Series for an airing series with no timer", async () => {
    (fetchProgram as jest.Mock).mockResolvedValue(airing);
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    const tree = await mount();
    expect(buttons(tree)).toEqual(["Watch", "Record", "Record Series"]);
    await press(tree, "Watch");
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/player", params: { videoId: "c1", videoName: "One" } });
  });

  it("records from the server's defaults and then offers to cancel", async () => {
    (fetchProgram as jest.Mock).mockResolvedValue(later);
    (fetchTimers as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ Id: "t1", Name: "Football Live", ProgramId: "p1", StartDate: later.StartDate, EndDate: later.EndDate, Status: "New" }]);
    const tree = await mount();
    expect(buttons(tree)).toEqual(["Record", "Record Series"]);
    await press(tree, "Record");
    expect(fetchTimerDefaults).toHaveBeenCalledWith("p1");
    expect(createTimer).toHaveBeenCalledWith({ ProgramId: "p1", Name: "Football Live" });
    expect(buttons(tree)).toEqual(["Cancel Recording", "Record Series"]);
  });

  it("cancels a timer and a series rule by their ids", async () => {
    (fetchProgram as jest.Mock).mockResolvedValue(later);
    (fetchTimers as jest.Mock)
      .mockResolvedValueOnce([{ Id: "t2", Name: "Football Live", ProgramId: "p1", SeriesTimerId: "s1", StartDate: later.StartDate, EndDate: later.EndDate, Status: "New" }])
      .mockResolvedValue([]);
    const tree = await mount();
    expect(buttons(tree)).toEqual(["Cancel Recording", "Cancel Series"]);
    await press(tree, "Cancel Recording");
    expect(cancelTimer).toHaveBeenCalledWith("t2");
    expect(buttons(tree)).toEqual(["Record", "Record Series"]);
  });
});
