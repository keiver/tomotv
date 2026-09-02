/**
 * Tests for useSelectSavedServer: a saved server that stopped answering at its
 * saved address is looked for on the LAN by its system Id before the tap gives
 * up, on both the token-reconnect path and the login fallback. Rendered with
 * react-test-renderer through a null-rendering harness, the same pattern as
 * hooks/__tests__/useFolderPlay.test.tsx.
 */
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Alert } from "react-native";
import { useSelectSavedServer } from "@/hooks/useSelectSavedServer";
import { activateAccount, checkQuickConnectEnabled, getAccountsForServer, resolveServerConnection, upsertSavedServer } from "@/services/jellyfinApi";
import { findServerById } from "@/services/networkDiscovery";
import { SavedAccount, SavedServer } from "@/types/jellyfin";

const mockPush = jest.fn();
const mockFinishLogin = jest.fn().mockResolvedValue(undefined);

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/hooks/useFinishLogin", () => ({
  useFinishLogin: () => mockFinishLogin,
}));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/jellyfinApi", () => ({
  activateAccount: jest.fn(),
  checkQuickConnectEnabled: jest.fn().mockResolvedValue(false),
  getAccountsForServer: jest.fn(),
  resolveServerConnection: jest.fn(),
  upsertSavedServer: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/services/networkDiscovery", () => ({
  findServerById: jest.fn(),
}));

const mockActivate = activateAccount as jest.Mock;
const mockAccounts = getAccountsForServer as jest.Mock;
const mockResolve = resolveServerConnection as jest.Mock;
const mockUpsertServer = upsertSavedServer as jest.Mock;
const mockFind = findServerById as jest.Mock;
const mockQuickConnect = checkQuickConnectEnabled as jest.Mock;

const OLD_URL = "http://192.168.40.19:8096";
const NEW_URL = "http://192.168.40.89:8096";
const SERVER: SavedServer = { id: OLD_URL, name: "local-demo", url: OLD_URL, lastConnectedAt: 1, serverId: "srv-1" };
const ACCOUNT: SavedAccount = {
  serverId: "srv-1",
  serverUrl: OLD_URL,
  serverName: "local-demo",
  userId: "user-1",
  userName: "keiver",
  authMethod: "password",
  deviceId: "device-a",
  lastUsedAt: 1,
};
const MOVED = { id: "srv-1", url: NEW_URL, name: "local-demo", version: "10.11.11" };

interface Handle {
  select: (server: SavedServer) => void;
}

const Harness = forwardRef<Handle>(function Harness(_props, ref) {
  const { selectServer } = useSelectSavedServer();
  useImperativeHandle(ref, () => ({ select: selectServer }), [selectServer]);
  return null;
});

const flush = () => act(async () => {});

/** Press the picker's "Continue as" button as soon as the alert shows. */
function pressContinueAs(userName: string) {
  jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    const button = buttons?.find((b) => b.text === `Continue as ${userName}`);
    button?.onPress?.();
  });
}

let handle: Handle;
beforeEach(() => {
  jest.clearAllMocks();
  const ref = React.createRef<Handle>();
  act(() => {
    TestRenderer.create(<Harness ref={ref} />);
  });
  handle = ref.current!;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Continue as a saved account", () => {
  it("finds the server at its new address and reconnects there when the saved one is dead", async () => {
    mockAccounts.mockResolvedValue([ACCOUNT]);
    mockActivate.mockResolvedValueOnce("unreachable").mockResolvedValueOnce("connected");
    mockFind.mockResolvedValue(MOVED);
    pressContinueAs("keiver");

    handle.select(SERVER);
    await flush();
    await flush();

    expect(mockFind).toHaveBeenCalledWith("srv-1");
    expect(mockUpsertServer).toHaveBeenCalledWith(NEW_URL, "local-demo", "srv-1");
    expect(mockActivate).toHaveBeenLastCalledWith({ ...ACCOUNT, serverUrl: NEW_URL });
    expect(mockFinishLogin).toHaveBeenCalled();
  });

  it("gives up with the unreachable alert only after the sweep finds nothing", async () => {
    mockAccounts.mockResolvedValue([ACCOUNT]);
    mockActivate.mockResolvedValue("unreachable");
    mockFind.mockResolvedValue(null);
    pressContinueAs("keiver");

    handle.select(SERVER);
    await flush();
    await flush();

    expect(mockFind).toHaveBeenCalledWith("srv-1");
    expect(mockActivate).toHaveBeenCalledTimes(1);
    expect(mockUpsertServer).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith("Server Unreachable", expect.stringContaining("local-demo"));
  });

  it("never sweeps for a card that has no server Id", async () => {
    mockAccounts.mockResolvedValue([ACCOUNT]);
    mockActivate.mockResolvedValue("unreachable");
    pressContinueAs("keiver");

    handle.select({ ...SERVER, serverId: undefined });
    await flush();
    await flush();

    expect(mockFind).not.toHaveBeenCalled();
  });
});

describe("login fallback with no saved account", () => {
  it("pushes the login step at the new address after the saved one fails to resolve", async () => {
    mockAccounts.mockResolvedValue([]);
    mockResolve.mockImplementation(async (url: string) => {
      if (url === NEW_URL) return { url, info: { ServerName: "local-demo", Version: "10.11.11", Id: "srv-1" } };
      throw new Error("Unable to reach Jellyfin server.");
    });
    mockFind.mockResolvedValue(MOVED);
    mockQuickConnect.mockResolvedValue(false);
    jest.spyOn(Alert, "alert").mockImplementation(() => {});

    handle.select(SERVER);
    await flush();
    await flush();

    expect(mockUpsertServer).toHaveBeenCalledWith(NEW_URL, "local-demo", "srv-1");
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/connect/login", params: { url: NEW_URL, name: "local-demo", serverId: "srv-1", username: undefined } });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("reports the original resolve error when the sweep finds nothing", async () => {
    mockAccounts.mockResolvedValue([]);
    mockResolve.mockRejectedValue(new Error("Unable to reach Jellyfin server."));
    mockFind.mockResolvedValue(null);
    jest.spyOn(Alert, "alert").mockImplementation(() => {});

    handle.select(SERVER);
    await flush();
    await flush();

    expect(mockPush).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith("Connection Failed", "Unable to reach Jellyfin server.");
  });
});
