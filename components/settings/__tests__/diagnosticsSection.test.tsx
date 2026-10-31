import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { DiagnosticsSection } from "@/components/settings/DiagnosticsSection";
import { ListRow } from "@/components/settings/ListRow";
import type { SentSession } from "@/services/diagnosticsOutbox";

const mockPush = jest.fn();
let mockOwn: object | null = null;
let mockSends: SentSession[] = [];
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: () => {} }));
jest.mock("@/components/settings/ListRow", () => ({ ListRow: () => null }));
jest.mock("@/components/settings/SwipeToRemove", () => ({ SwipeToRemove: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("react-native-gesture-handler", () => ({ GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/hooks/useLastSession", () => ({ useLastSession: () => mockOwn }));
jest.mock("@/hooks/useSentSessions", () => ({ useSentSessions: () => mockSends }));
jest.mock("@/services/diagnosticsLog", () => ({ logText: () => "", savedAt: () => 1700000000000 }));
jest.mock("@/utils/hostEnvironment", () => ({ THIS_DEVICE: "iPad" }));
jest.mock("@/services/playbackStory", () => ({ describePlayback: () => "" }));

const session = { device: { family: "Apple TV" } };
const sent: SentSession = { v: 2, sender: "abc-123", sentAt: 1700000000000, session: session as never };

function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<DiagnosticsSection />);
  });
  const found = tree.root.findAllByType(ListRow);
  return { tree, found, unmount: () => act(() => tree.unmount()) };
}

describe("DiagnosticsSection", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockOwn = null;
    mockSends = [];
  });

  it("renders nothing with no saved session and no received ones", () => {
    const { tree, found, unmount } = render();
    expect(found).toHaveLength(0);
    expect(tree.toJSON()).toBeNull();
    unmount();
  });

  it("names this device's session row after this device, first and last under its own header", () => {
    mockOwn = session;
    const { found, unmount } = render();
    expect(found.map((row) => ({ title: row.props.title, isFirst: !!row.props.isFirst, isLast: !!row.props.isLast }))).toEqual([{ title: "This iPad", isFirst: true, isLast: true }]);
    unmount();
  });

  it("names a received session row by sender family and id head, first when this device saved none", () => {
    mockSends = [sent];
    const { found, unmount } = render();
    expect(found.map((row) => ({ title: row.props.title, isFirst: !!row.props.isFirst, isLast: !!row.props.isLast }))).toEqual([{ title: "Apple TV ABC", isFirst: true, isLast: true }]);
    act(() => found[0].props.onPress());
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/diagnostics", params: { sender: "abc-123" } });
    unmount();
  });
});
