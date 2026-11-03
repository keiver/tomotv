import React, { useEffect } from "react";
import TestRenderer, { act } from "react-test-renderer";

import { PlayerSessionProvider, usePlayerSession, usePlayerSessionHost, type PlayerHostBridge, type PlayerSessionRequest, type PlayerTvConfig } from "../PlayerSessionContext";

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

function makeBridge(): jest.Mocked<PlayerHostBridge> {
  return {
    requestSession: jest.fn(),
    switchLiveChannel: jest.fn(),
    releaseRoute: jest.fn(),
    stopSession: jest.fn(),
    signalRoutePresented: jest.fn(),
    setTvConfig: jest.fn(),
    pause: jest.fn(),
    retry: jest.fn(),
    reloadSubtitles: jest.fn(),
    applySubtitleTimeOffset: jest.fn(),
    alignSubtitleTiming: jest.fn(),
    seekBy: jest.fn(),
    togglePlay: jest.fn(),
    toggleVideoFill: jest.fn(),
    setInlineFrame: jest.fn(),
    presentFullscreen: jest.fn(),
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

  it("hands an inline frame reported before the host registered to the host once it does", () => {
    const bridge = makeBridge();
    const frame = { x: 16, y: 120, width: 343, height: 193 };
    renderColdLaunch(bridge, (session) => {
      session.requestSession({ ...request("channel-1"), isLive: true, inline: true });
      session.setInlineFrame(frame);
    });

    expect(bridge.setInlineFrame).toHaveBeenCalledWith(frame);
    expect(bridge.requestSession.mock.invocationCallOrder[0]).toBeLessThan(bridge.setInlineFrame.mock.invocationCallOrder[0]);
  });

  it("gives the screen and the host the same inline offset", () => {
    const seen: unknown[] = [];
    function Screen() {
      seen.push(usePlayerSession().inlineOffsetY);
      return null;
    }
    function HostSide() {
      seen.push(usePlayerSessionHost().inlineOffsetY);
      return null;
    }
    act(() => {
      TestRenderer.create(
        <PlayerSessionProvider>
          <Screen />
          <HostSide />
        </PlayerSessionProvider>,
      );
    });
    expect(seen[0]).toBeDefined();
    expect(seen[1]).toBe(seen[0]);
  });

  it("hands a cleared inline frame to the host too", () => {
    const bridge = makeBridge();
    renderColdLaunch(bridge, (session) => session.setInlineFrame(null));

    expect(bridge.setInlineFrame).toHaveBeenCalledWith(null);
  });

  it("asks a registered host for full screen, and drops the ask when there is no host", () => {
    const bridge = makeBridge();
    renderColdLaunch(bridge, (session) => session.presentFullscreen());
    expect(bridge.presentFullscreen).not.toHaveBeenCalled();

    const tree = renderColdLaunch(bridge, () => {}, false);
    act(() => {
      tree.update(
        <PlayerSessionProvider>
          <Route run={(session) => session.presentFullscreen()} />
          <Host bridge={bridge} />
        </PlayerSessionProvider>,
      );
    });
    expect(bridge.presentFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe("PlayerSessionContext handlers", () => {
  const handlers = (name: string) => ({
    onPlaybackEnd: jest.fn(),
    onContentProposalAccepted: jest.fn(),
    onContentProposalRejected: jest.fn(),
    onInfoPanelItemSelected: jest.fn(),
    onSkipChannel: jest.fn(),
    onTransportBarButtonSelected: jest.fn(),
    onRequestBack: jest.fn(() => name),
  });

  function HandlersProbe({ run }: { run: (session: ReturnType<typeof usePlayerSession>, host: ReturnType<typeof usePlayerSessionHost>) => void }) {
    const session = usePlayerSession();
    const host = usePlayerSessionHost();
    useEffect(() => run(session, host), []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
  }

  it("clears the handlers that asked to be cleared", () => {
    let registered: unknown = "unset";
    const own = handlers("live-tv");
    act(() => {
      TestRenderer.create(
        <PlayerSessionProvider>
          <HandlersProbe
            run={(session, host) => {
              session.setHandlers(own);
              session.clearHandlers(own);
              registered = host.handlersRef.current;
            }}
          />
        </PlayerSessionProvider>,
      );
    });
    expect(registered).toBeNull();
  });

  it("keeps the handlers of a screen that took over when the one before it clears its own", () => {
    let registered: unknown = null;
    const before = handlers("live-tv");
    const after = handlers("player");
    act(() => {
      TestRenderer.create(
        <PlayerSessionProvider>
          <HandlersProbe
            run={(session, host) => {
              session.setHandlers(before);
              session.setHandlers(after);
              session.clearHandlers(before);
              registered = host.handlersRef.current;
            }}
          />
        </PlayerSessionProvider>,
      );
    });
    expect(registered).toBe(after);
  });
});
