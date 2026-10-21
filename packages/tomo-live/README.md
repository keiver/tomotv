# @keiver/tomo-live

The live TV services behind [Tomo TV](https://github.com/keiver/tomotv), over
[`@keiver/tomo-engine`](../tomo-engine), for Expo apps on Apple TV, iOS and Mac Catalyst: a warm ring of
neighbour channels so a flip binds a session already cutting segments, a warm session for the
focused channel card, frame and clip sampling for channel cards, channel health judged from
those grabs, and XMLTV guide sources cached on disk and matched to the app's channels.

## Install

```sh
npm install @keiver/tomo-engine @keiver/tomo-live
```

The `LiveClip` view (a muted looping clip for a channel card) is an Expo module, linked by
autolinking at `expo prebuild`.

## Wiring

The services never resolve a channel themselves. The app hands them its channels once, before
any live screen runs:

```ts
import { configureLive } from "@keiver/tomo-live";

configureLive({
  channels: {
    resolve,
    resolveWithoutOpen,
    resolveOrigin,
    open,
    close,
    holdsOpen,
    streamUrl,
    name,
    canPlayOnDevice,
    startSession,
    subscribeListChange,
  },
});
```

`LiveChannels` in `src/config.ts` documents each member. Logging goes through the engine's
`configureEngine({ log })`.

## Live playback controller

A playing channel stays on the engine: the engine reopens a lost input inside the session, and
the app starts a new session only when that one ends. `watchLiveSession` follows a session for its
whole life and says what to do when it ends:

```ts
import { LiveDropCounter, watchLiveSession } from "@keiver/tomo-live";

const drops = new LiveDropCounter(); // one per channel play, kept across its sessions
const stop = watchLiveSession(token, drops, {
  onReopening: () => showBuffering(),
  onReopened: () => hideBuffering(),
  onEnded: (message, decision) => (decision.reopen ? setTimeout(startAgain, decision.delayMs) : showError(message)),
});
```

`planLiveRecovery` is the rule behind `decision`: reopen after 0.5, 1, 2, 4, then 5 s
(`LIVE_REOPEN_DELAYS_MS`), counted from zero again once the channel played
`LIVE_RECOVERY_RESET_MS` (60 s) without a drop, and stop only on a failure no open fixes
(`isPermanentLiveFailure`: the engine gave the input up, the origin refused every path, or DRM).

## Channel origins

`channelOrigin` holds the origin rules a client needs before it opens a channel:
`splitPipeHeaders` (a `url|Header=value` playlist entry), `originKeyOf`, `mergeOriginHeaders`,
`manifestDrm`, `drmKeyFormat` and `dashProtection` (a DRM channel is refused before the engine
opens it), and `originReach`, `isOriginLaneAvailable` and `resetOriginReach` (whether this device
reaches a provider's host, remembered per host for two minutes; reset it on a network or account
switch).

## Playlist channels

`syncPlaylistSources` builds a channel table from M3U playlists parsed on device, with
`enginePlaylistRows` as the stock loader. A `PlaylistChannel` carries the stream URL and its
headers, `originKey` (the provider host a read's connection lease is taken on; `playlistOriginKey`
derives the same key for any URL of that provider), and, when the playlist declares them, the
channel's archive (`catchup`: type, source template, days) and guide shift (`tvgShift`).

## Releasing

A commit that touches this package while its version is already on npm gets a patch bump from the
pre-commit hook (`scripts/package-versions.mjs`), and Test PR fails a change that reached GitHub
without one. A minor or major bump is `npm run release:live -- minor|major` with a `CHANGELOG.md`
entry. When the PR merges to `main`,
`.github/workflows/publish-packages.yml` publishes any version npm does not have yet, with
provenance, and creates the `tomo-live-v<version>` GitHub release.
