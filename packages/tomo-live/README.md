# @keiver/tomo-live

The live TV services behind [Tomo TV](https://github.com/keiver/tomotv), over
[`@keiver/tomo-engine`](../tomo-engine), for Expo apps on Apple TV and iOS: a warm ring of
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
