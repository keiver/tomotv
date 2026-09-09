/**
 * The server websocket: keepalive answering, reconnect backoff, and the AppState open/close.
 * A hand-rolled global.WebSocket captures sent frames and lets the test drive open/close/message.
 */
jest.mock("@/services/jellyfin/session", () => ({
  getConfig: jest.fn().mockResolvedValue({ server: "http://host:8096", apiKey: "tok", userId: "u", deviceId: "d" }),
}));
jest.mock("@/services/jellyfin/events", () => ({
  subscribeAuthChange: jest.fn(() => () => {}),
}));

import { AppState } from "react-native";

let appStateHandler: ((state: string) => void) | null = null;

const sockets: FakeSocket[] = [];
class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    sockets.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  message(obj: object) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

describe("server socket", () => {
  let socketModule: typeof import("../jellyfin/socket");
  beforeEach(() => {
    jest.useFakeTimers();
    sockets.length = 0;
    appStateHandler = null;
    (AppState as unknown as { currentState: string }).currentState = "active";
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, cb) => {
      appStateHandler = cb as (state: string) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    (global as unknown as { WebSocket: typeof FakeSocket }).WebSocket = FakeSocket;
    jest.isolateModules(() => {
      socketModule = require("../jellyfin/socket");
    });
  });
  afterEach(() => {
    socketModule.resetServerSocketForTests();
    jest.useRealTimers();
  });

  it("answers ForceKeepAlive at once and again at half the timeout", async () => {
    socketModule.openServerSocket();
    await Promise.resolve();
    sockets[0].open();
    sockets[0].message({ MessageType: "ForceKeepAlive", Data: 60 });
    expect(JSON.parse(sockets[0].sent[0])).toEqual({ MessageType: "KeepAlive" });
    jest.advanceTimersByTime(30_000);
    expect(sockets[0].sent.length).toBe(2);
  });

  it("dispatches a message to a typed subscriber", async () => {
    socketModule.openServerSocket();
    await Promise.resolve();
    const seen: unknown[] = [];
    socketModule.subscribeServerMessage("SyncPlayCommand", (data) => seen.push(data));
    sockets[0].open();
    sockets[0].message({ MessageType: "SyncPlayCommand", Data: { Command: "Pause" } });
    expect(seen).toEqual([{ Command: "Pause" }]);
  });

  it("reconnects on the backoff ladder after an unwanted close", async () => {
    socketModule.openServerSocket();
    await Promise.resolve();
    sockets[0].open();
    sockets[0].close();
    expect(sockets.length).toBe(1);
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(sockets.length).toBe(2);
  });

  it("stops reconnecting after closeServerSocket", async () => {
    socketModule.openServerSocket();
    await Promise.resolve();
    sockets[0].open();
    socketModule.closeServerSocket();
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(sockets.length).toBe(1);
  });

  it("closes on background and reopens on active", async () => {
    socketModule.openServerSocket();
    await Promise.resolve();
    sockets[0].open();
    appStateHandler?.("background");
    expect(sockets[0].readyState).toBe(FakeSocket.CLOSED);
    appStateHandler?.("active");
    await Promise.resolve();
    expect(sockets.length).toBe(2);
  });

  it("resolves whenServerSocketOpen once the socket connects", async () => {
    socketModule.openServerSocket();
    await Promise.resolve();
    let resolved = false;
    void socketModule.whenServerSocketOpen().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    sockets[0].open();
    await Promise.resolve();
    expect(resolved).toBe(true);
  });
});
