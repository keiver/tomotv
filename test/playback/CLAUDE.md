# Playback regression suite

**The testing library is `~/Movies/development-videos`.** That directory is what
identifies the fixture set. A Jellyfin library name is not, and never was, a
reliable handle on it.

Full runbook: [`README.md`](./README.md). This file is the part that must be true
before anything else is worth reading.

## The three fixture roots

| Root                           | Holds                                  |
| ------------------------------ | -------------------------------------- |
| `~/Movies/development-videos`  | every video fixture (T01-T45, T60-T98) |
| `~/Music/Development Audio`    | stereo audio-only (T50-T55)            |
| `~/Music/Development Surround` | surround audio-only (T56, T70-T73)     |

71 manifest items resolve out of these. `resolveItems` matches a title only when
the item's own directory is one of the roots, so the driver does not care which
library holds them, how many libraries cover the path, or what they are called.
Override the roots with `JELLYFIN_FIXTURE_ROOTS` in `.env.playback-test`.

## What the server is allowed to look like

Anything that indexes the roots. A catch-all `Movies` library over `~/Movies` is
fine. Two facts make library names useless as a scope, both measured on 10.11.11:

- A library nested inside another library's folder **indexes empty**. The outer
  library owns the files, and Jellyfin logs `Found duplicate path`.
- Two libraries over one path answer the **same item ids**, so no query
  separates them. `/Items` accepts `ParentId` and nothing else.

`npm run make:test-media -- --with-library` registers three named libraries as a
convenience. It is not a prerequisite, and on a server whose libraries already
cover `~/Movies` and `~/Music` those three will index nothing.

## Duplicate copies of the fixtures

`~/Movies/Computer Media/tomotv-demo-staging/` holds a second copy of 30 fixtures,
staged for the cubita demo server. It is outside the roots, so it is ignored by
construction. Two files sharing a title **inside** a root still fail the run
loudly, which is the case worth failing on.

## Before a run

- `.env.playback-test` (gitignored): `JELLYFIN_URL`, `JELLYFIN_API_KEY`. Optional
  `BUNDLE_ID`, `JELLYFIN_FIXTURE_ROOTS`.
- `npm run test:playback:preflight` covers all eight prerequisites, and its
  server checks are authenticated. `/System/Info/Public` answers 200 to a dead
  key, so a reachability check that skips auth proves nothing.
- Pass `--udid` whenever more than one simulator is booted.
- The app must be signed in to the same server the harness resolves ids from.
  `JELLYFIN_USER` + `JELLYFIN_PASSWORD` in the env make the run sign a dev build
  in itself (`tomotv://dev-session`); otherwise one line names the host it
  actually talks to:
  `xcrun simctl spawn <udid> log show --last 45m --predicate 'process == "TomoTV"' | grep -o -E "url: https?://[^/]+" | sort | uniq -c`
- Metro must be running for a dev build, and detached, not inside a tool call
  that times out.
- A fresh install shows tvOS's one-time "Open in Tomo TV?" dialog on the first
  deep link. Every item reads "no probe events" until someone clicks it.
- Warm the platform with `--only T01` before a full run. Metro builds one bundle
  per platform, the suite's prewarm does not cover a cold one, and a first iOS
  run after a tvOS run fails every item with "no probe events" while the app is
  playing correctly. The probe file's own timestamps, later than the driver's
  window, are what tell the two apart.

## During a run

App source and Jellyfin configuration are frozen. Stop the run, change, restart.
Never pipe the run through `tail`: it eats the per-item detail and the exit code.

## Baselines

33 committed under `baselines/`. They pin stream-copy packet hashes for six items
(T05, T07, T08, T09, T10, T11). `--update-baselines` records them again, and it
erases whatever an engine change did to the copy path, so it runs only on a build
someone has confirmed is good.
