# Changelog

## 1.0.0

First release, extracted from Tomo TV.

- `configureLive`: the app's channels (resolve, open, close, engine session start, list changes) as the one injection point.
- Live ring: neighbours of the playing channel kept hot in the engine during a surf window, handed to the player on a flip.
- Live preview: the focused card's warm session, adopted by the player on play.
- Live frames: frame bursts and preview clips for the cards in view, one channel at a time, with backoff and a provider-cap rest.
- Channel health from the grabs' own outcomes, and the open-failure memo.
- XMLTV guide sources: on-disk cache keyed by URL, tvg-id then name matching, per-guide status.
- `LiveClip` Expo module: a muted looping clip view from a pool of preview players.
