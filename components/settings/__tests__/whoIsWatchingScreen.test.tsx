import { sortedPeople, WhoIsWatchingScreen } from "@/components/settings/WhoIsWatchingScreen";
import type { SavedAccount, SavedServer } from "@/types/jellyfin";
import React from "react";
import { Alert } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockApi = { getSavedServersWithAccounts: jest.fn(), connectToDemoServer: jest.fn() };
jest.mock("@/services/jellyfinApi", () => ({
  getSavedServersWithAccounts: () => mockApi.getSavedServersWithAccounts(),
  connectToDemoServer: () => mockApi.connectToDemoServer(),
  isAddressTitle: (name: string) => /^\d/.test(name),
}));
const mockCalls: string[] = [];
const mockFinishLogin = jest.fn(async () => {
  mockCalls.push("finishLogin");
});
jest.mock("@/hooks/useFinishLogin", () => ({ useFinishLogin: () => mockFinishLogin }));
const mockSelect = { continueAs: jest.fn(), accountOptions: jest.fn(), activatingServerId: null as string | null, activatingUserId: null as string | null };
jest.mock("@/hooks/useSelectSavedServer", () => ({ useSelectSavedServer: () => mockSelect }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    const { useEffect } = jest.requireActual<typeof React>("react");
    useEffect(effect, [effect]);
  },
}));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/brand-corners", () => ({ BrandCorners: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }));
jest.mock("@/components/settings/AccountAvatar", () => ({ AccountAvatar: () => null }));
jest.mock("@/components/settings/NotConnectedSection", () => ({ serverHost: (address: string) => address.replace(/:.*$/, "") }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn() } }));

const { AccountAvatar } = jest.requireMock("@/components/settings/AccountAvatar") as { AccountAvatar: React.ComponentType };

const server = (id: string, name: string): SavedServer => ({ id, url: `http://${id}`, name, serverId: `sys-${id}`, lastConnectedAt: 0 });
const account = (serverId: string, userName: string, lastUsedAt: number): SavedAccount => ({
  serverId: `sys-${serverId}`,
  serverUrl: `http://${serverId}`,
  serverName: serverId,
  userId: `u-${userName}`,
  userName,
  authMethod: "password",
  deviceId: "d",
  lastUsedAt,
});

const home = server("home", "Home");
const office = server("office", "10.0.0.5:8096");
const ana = account("home", "Ana", 300);
const ben = account("home", "Ben", 100);
const cy = account("office", "Cy", 200);

async function render() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<WhoIsWatchingScreen />);
  });
  return renderer;
}

const cells = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType(AccountAvatar).map((node) => node.props);

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
});

describe("sortedPeople", () => {
  it("lists every saved account across servers, most recently used first", () => {
    const people = sortedPeople([home, office], { [home.id]: [ben, ana], [office.id]: [cy] });
    expect(people.map((person) => person.account.userName)).toEqual(["Ana", "Cy", "Ben"]);
    expect(people[1].server).toBe(office);
  });
});

describe("WhoIsWatchingScreen", () => {
  it("shows a Demo face and Add Server when no account is saved", async () => {
    mockApi.getSavedServersWithAccounts.mockResolvedValue({ servers: [], accountsByServer: {} });
    const renderer = await render();
    const props = cells(renderer);
    expect(props.map((p) => p.label)).toEqual(["connect.demoPerson", "settings.addServer"]);
    expect(props[0].sublabel).toBe("Tomo TV");
    expect(props[1].icon).toBe("add");
  });

  it("shows the saved accounts most recently used first, with their server under each, and no Demo face", async () => {
    mockApi.getSavedServersWithAccounts.mockResolvedValue({ servers: [home, office], accountsByServer: { [home.id]: [ben, ana], [office.id]: [cy] } });
    const renderer = await render();
    const props = cells(renderer);
    expect(props.map((p) => p.label)).toEqual(["Ana", "Cy", "Ben", "settings.addServer"]);
    expect(props.map((p) => p.sublabel)).toEqual(["Home", "10.0.0.5", "Home", undefined]);
  });

  it("a press continues as that account and a long press opens its options", async () => {
    mockApi.getSavedServersWithAccounts.mockResolvedValue({ servers: [home], accountsByServer: { [home.id]: [ana] } });
    const renderer = await render();
    const [person] = cells(renderer);
    person.onPress();
    expect(mockSelect.continueAs).toHaveBeenCalledWith(home, ana);
    person.onLongPress();
    expect(mockSelect.accountOptions).toHaveBeenCalledWith(home, ana, expect.any(Function));
  });

  it("turns the ring of the account that is connecting", async () => {
    mockApi.getSavedServersWithAccounts.mockResolvedValue({ servers: [home], accountsByServer: { [home.id]: [ana, ben] } });
    mockSelect.activatingServerId = home.id;
    mockSelect.activatingUserId = ben.userId;
    const renderer = await render();
    expect(cells(renderer).map((p) => p.loading)).toEqual([false, true, undefined]);
    mockSelect.activatingServerId = null;
    mockSelect.activatingUserId = null;
  });

  it("the Demo face signs into the demo, then finishes the login", async () => {
    mockApi.getSavedServersWithAccounts.mockResolvedValue({ servers: [], accountsByServer: {} });
    mockApi.connectToDemoServer.mockImplementation(async () => {
      mockCalls.push("connectToDemoServer");
    });
    const renderer = await render();
    await act(async () => {
      cells(renderer)[0].onPress();
    });
    expect(mockCalls).toEqual(["connectToDemoServer", "finishLogin"]);
  });

  it("a failed demo sign-in shows the alert and leaves the screen usable", async () => {
    mockApi.getSavedServersWithAccounts.mockResolvedValue({ servers: [], accountsByServer: {} });
    mockApi.connectToDemoServer.mockRejectedValue(new Error("offline"));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const renderer = await render();
    await act(async () => {
      cells(renderer)[0].onPress();
    });
    expect(alert).toHaveBeenCalledWith("connect.demoConnectionFailed", "offline");
    expect(mockFinishLogin).not.toHaveBeenCalled();
    expect(cells(renderer).map((p) => p.disabled)).toEqual([undefined, false]);
    alert.mockRestore();
  });

  it("Add Server opens the connect screen", async () => {
    mockApi.getSavedServersWithAccounts.mockResolvedValue({ servers: [], accountsByServer: {} });
    const renderer = await render();
    cells(renderer)[1].onPress();
    expect(mockPush).toHaveBeenCalledWith("/connect/servers");
  });
});
