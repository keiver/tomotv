/**
 * One websocket to the active server, open only while something wants it (a SyncPlay
 * group). Messages are {MessageType, Data, MessageId}; subscribers register per type.
 * Keepalive and reconnect are handled here; the caller only opens and closes.
 */
import { logger } from "@/utils/logger";
import { AppState, AppStateStatus, NativeEventSubscription } from "react-native";
import { SYNC_PLAY } from "../syncPlayTiming";
import { subscribeAuthChange } from "./events";
import { getConfig } from "./session";

export interface ServerSocketMessage {
  MessageType: string;
  Data?: unknown;
  MessageId?: string;
}

type Listener = (data: unknown) => void;

let socket: WebSocket | null = null;
let wanted = false;
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: NativeEventSubscription | null = null;
let authSubscription: (() => void) | null = null;
const listeners = new Map<string, Set<Listener>>();
const openListeners = new Set<() => void>();

export function subscribeServerMessage(type: string, cb: Listener): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
  };
}

/** Fires on every successful open, including reconnects. */
export function subscribeServerSocketOpen(cb: () => void): () => void {
  openListeners.add(cb);
  return () => openListeners.delete(cb);
}

export function isServerSocketOpen(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

let openWaiters: (() => void)[] = [];

/** Resolves once the socket is open, so a caller can wait before issuing a request whose
 *  reply arrives over the socket. Resolves on the next close too, so it never hangs. */
export function whenServerSocketOpen(): Promise<void> {
  if (isServerSocketOpen()) return Promise.resolve();
  return new Promise((resolve) => openWaiters.push(resolve));
}

function flushOpenWaiters(): void {
  const waiters = openWaiters;
  openWaiters = [];
  waiters.forEach((resolve) => resolve());
}

function clearTimers(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

function send(message: ServerSocketMessage): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function armKeepAlive(timeoutSeconds: number): void {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  const seconds = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : SYNC_PLAY.KEEPALIVE_FALLBACK_S;
  keepAliveTimer = setInterval(() => send({ MessageType: "KeepAlive" }), (seconds * 1000) / 2);
}

function dispatch(raw: string): void {
  let message: ServerSocketMessage;
  try {
    message = JSON.parse(raw) as ServerSocketMessage;
  } catch {
    return;
  }
  if (message.MessageType === "ForceKeepAlive") {
    send({ MessageType: "KeepAlive" });
    armKeepAlive(Number(message.Data));
    return;
  }
  if (message.MessageType === "KeepAlive") return;
  listeners.get(message.MessageType)?.forEach((cb) => cb(message.Data));
}

function scheduleReconnect(): void {
  if (!wanted || reconnectTimer) return;
  const ladder = SYNC_PLAY.RECONNECT_BACKOFF_MS;
  const delay = ladder[Math.min(attempt, ladder.length - 1)];
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

async function connect(): Promise<void> {
  if (!wanted || socket) return;
  const config = await getConfig();
  if (!wanted || socket) return;
  if (!config.server || !config.apiKey) {
    scheduleReconnect();
    return;
  }
  const url = `${config.server.replace(/^http/, "ws")}/socket?api_key=${encodeURIComponent(config.apiKey)}&deviceId=${encodeURIComponent(config.deviceId)}`;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    attempt = 0;
    logger.info("Server socket open", { service: "ServerSocket" });
    flushOpenWaiters();
    openListeners.forEach((cb) => cb());
  };
  ws.onmessage = (event) => {
    if (socket !== ws) return;
    dispatch(String(event.data));
  };
  ws.onerror = () => {
    if (socket !== ws) return;
    logger.debug("Server socket error", { service: "ServerSocket" });
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = null;
    scheduleReconnect();
  };
}

function teardownSocket(): void {
  clearTimers();
  flushOpenWaiters();
  const current = socket;
  socket = null;
  if (current) {
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    try {
      current.close();
    } catch {
      // A socket that never connected has nothing to close.
    }
  }
}

function handleAppState(state: AppStateStatus): void {
  if (state === "background") {
    // iOS suspends the socket and the server drops the session on the missed keepalive.
    teardownSocket();
    return;
  }
  if (state === "active" && wanted && !socket) {
    attempt = 0;
    void connect();
  }
}

export function openServerSocket(): void {
  wanted = true;
  if (!appStateSubscription) appStateSubscription = AppState.addEventListener("change", handleAppState);
  if (!authSubscription) authSubscription = subscribeAuthChange(closeServerSocket);
  if (AppState.currentState === "background") return;
  attempt = 0;
  void connect();
}

export function closeServerSocket(): void {
  wanted = false;
  teardownSocket();
  appStateSubscription?.remove();
  appStateSubscription = null;
  authSubscription?.();
  authSubscription = null;
}

export function resetServerSocketForTests(): void {
  closeServerSocket();
  listeners.clear();
  openListeners.clear();
  attempt = 0;
}
