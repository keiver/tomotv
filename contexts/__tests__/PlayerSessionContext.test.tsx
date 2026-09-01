import React, { useEffect } from "react";
import TestRenderer, { act } from "react-test-renderer";

import { PlayerSessionProvider, usePlayerSession, usePlayerSessionHost, type PlayerHostBridge, type PlayerSessionRequest, type PlayerTvConfig } from "../PlayerSessionContext";

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

function makeBridge(): jest.Mocked<PlayerHostBridge> {
  return {
    requestSession: jest.fn(),
    releaseRoute: jest.fn(),
    stopSession: jest.fn(),
    signalRoutePresented: jest.fn(),
    setTvConfig: jest.fn(),
    pause: jest.fn(),
    retry: jest.fn(),
    seekBy: jest.fn(),
    togglePlay: jest.fn(),
  };
}

const request = (videoId: string, sessionKey = "in-app:0"): PlayerSessionRequest => ({ videoId, sessionKey });

/** Stands in for the /player route: commands the host from a mount effect. */
function Route({ run }: { run: (session: ReturnType<typeof usePlayerSession>) => void | (() => void) }) {
  const session = usePlayerSession();
  useEffect(() => run(session), []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Stands in for PlayerHost: registers its bridge from a mount effect. */
function Host({ bridge }: { bridge: PlayerHostBridge }) {
  const { registerHost } = usePlayerSessionHost();
  useEffect(() => {
    registerHost(bridge);
    return () => registerHost(null);
  }, [registerHost, bridge]);
  return null;
}

/**
 * The cold-launch tree, in the order app/_layout.tsx renders it: the navigator (and so
 * the route) BEFORE PlayerHost, both mounting in one commit. Effects fire in tree order,
 * so the route commands a host that has not registered yet.
 */
function renderColdLaunch(bridge: PlayerHostBridge, run: (session: ReturnType<typeof usePlayerSession>) => void | (() => void), withRoute = true) {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <PlayerSessionProvider>
        {withRoute && <Route run={run} />}
        <Host bridge={bridge} />
      </PlayerSessionProvider>,
    );
  });
  return tree!;
}

describe("PlayerSessionContext handoff", () => {
  it("starts the session requested before the host registered", () => {
    const bridge = makeBridge();
    renderColdLaunch(bridge, (session) => session.requestSession(request("video1")));

    expect(bridge.requestSession).toHaveBeenCalledTimes(1);
    expect(bridge.requestSession).toHaveBeenCalledWith(expect.objectContaining({ videoId: "video1" }));
  });

  it("keeps only the latest request when several arrive before the host", () => {
    const bridge = makeBridge();
    renderColdLaunch(bridge, (session) => {
      session.requestSession(request("video1"));
      session.requestSession(request("video2"));
    });

    expect(bridge.requestSession).toHaveBeenCalledTimes(1);
    expect(bridge.requestSession).toHaveBeenCalledWith(expect.objectContaining({ videoId: "video2" }));
  });

  it("replays the tvOS config and the presentation signal after the session", () => {
    const bridge = makeBridge();
    const tvConfig: PlayerTvConfig = { contextualActions: [] };
    renderColdLaunch(bridge, (session) => {
      session.requestSession(request("video1"));
      session.setTvConfig(tvConfig);
      session.signalRoutePresented();
    });

    expect(bridge.setTvConfig).toHaveBeenCalledWith(tvConfig);
    expect(bridge.signalRoutePresented).toHaveBeenCalledTimes(1);
    expect(bridge.requestSession.mock.invocationCallOrder[0]).toBeLessThan(bridge.setTvConfig.mock.invocationCallOrder[0]);
    expect(bridge.setTvConfig.mock.invocationCallOrder[0]).toBeLessThan(bridge.signalRoutePresented.mock.invocationCallOrder[0]);
  });

  it("drops a queued request when its route unmounts before the host arrives", () => {
    const bridge = makeBridge();
    // No host at all yet: the route asks, then leaves (its releaseRoute cleanup runs), and
    // only then does the host register. Nothing should start.
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <PlayerSessionProvider>
          <Route
            run={(session) => {
              session.requestSession(request("video1"));
              return () => session.releaseRoute({ videoId: "video1", sessionKey: "in-app:0" });
            }}
          />
        </PlayerSessionProvider>,
      );
    });
    act(() => {
      tree!.update(
        <PlayerSessionProvider>
          <Host bridge={bridge} />
        </PlayerSessionProvider>,
      );
    });

    expect(bridge.requestSession).not.toHaveBeenCalled();
    expect(bridge.releaseRoute).not.toHaveBeenCalled();
  });

  it("drops a queued request when the route stops the session before the host arrives", () => {
    const bridge = makeBridge();
    renderColdLaunch(bridge, (session) => {
      session.requestSession(request("video1"));
      session.stopSession();
    });

    expect(bridge.requestSession).not.toHaveBeenCalled();
  });

  it("forwards straight through once the host is registered", () => {
    const bridge = makeBridge();
    const tree = renderColdLaunch(bridge, () => {}, false);

    act(() => {
      tree.update(
        <PlayerSessionProvider>
          <Route run={(session) => session.requestSession(request("video1"))} />
          <Host bridge={bridge} />
        </PlayerSessionProvider>,
      );
    });

    expect(bridge.requestSession).toHaveBeenCalledTimes(1);
  });

  it("does not replay a started session to the next bridge the host registers", () => {
    const first = makeBridge();
    const second = makeBridge();
    const tree = renderColdLaunch(first, (session) => session.requestSession(request("video1")));
    expect(first.requestSession).toHaveBeenCalledTimes(1);

    // PlayerHost rebuilds its bridge whenever any of its deps change, which unregisters
    // and re-registers. The held command is intent, not a log of calls: it is spent.
    act(() => {
      tree.update(
        <PlayerSessionProvider>
          <Route run={() => {}} />
          <Host bridge={second} />
        </PlayerSessionProvider>,
      );
    });

    expect(second.requestSession).not.toHaveBeenCalled();
  });

  it("does not throw when a gesture command finds no host", () => {
    const bridge = makeBridge();
    expect(() =>
      renderColdLaunch(bridge, (session) => {
        session.pause();
        session.retry();
      }),
    ).not.toThrow();
    expect(bridge.pause).not.toHaveBeenCalled();
    expect(bridge.retry).not.toHaveBeenCalled();
  });
});
