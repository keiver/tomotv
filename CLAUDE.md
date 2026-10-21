# CLAUDE.md

**TomoTV** is a Jellyfin client built with React Native TVOS and Expo for Apple TV, iPhone, iPad and Mac Catalyst (macOS 13.4 or later). Playback runs through our own on-device engine (`packages/tomo-engine`); live TV runs through `packages/tomo-live` on top of it. The server transcodes only what the engine cannot take.

This file is an index. The global `~/.claude/CLAUDE.md` holds the general working rules; nothing here repeats them. Instructions that matter only while editing certain code live in `.claude/rules/` and load when that code is touched: `.claude/rules/tomo-engine.md`, `.claude/rules/tomo-live.md`, `.claude/rules/native-swift.md`, `.claude/rules/tvos-ui.md`. They stay out of `packages/`, where any changed file counts as a package release for `scripts/package-versions.mjs`. `__tests__/claudeMd.test.ts` pins every path, script, package and symbol these files name, so a stale line fails `npm test`.

## THE ULTIMATE RULE: NO ASSUMPTIONS. EVER.

Every claim is confirmed before I state, act on or commit it: read the code path, run the probe, research the source. Runtime state (a measurement, a cache, a server) gets checked, never assumed. "It should" is banned; "measured/read/probed: it does" is the only form.

- A plan is a claim: measure every mechanism before it ships, never defer it or list it as "open". An unconfirmed mechanism never ships, even when told "add the fix".
- Shipped-app behaviour needs a device run, not a source read. SDK availability is not adoption.
- Provenance comes from `git log -S`, never one commit's diff.
- A finding is traced to a consequence at a file:line I opened, or it is not reported.
- Apple/native API names and availability: grep the installed SDK headers or `xcrun swiftc -typecheck` a probe. Apple Developer Forums are never a source.
- Never say "cannot"/"impossible" before grepping the repo for an existing mechanism (e.g. `scripts/transcode-bench.mjs` already drives the Apple TV).
- Open every file my own search returned before theorizing about it.
- Confirming a defect is real is not confirming a fix is safe: find the invariant the current shape protects first.

## MAIN RULE: THE CODE PROVES THE FIX, NEVER A TEST

A fix is complete when I have read every file on its path in full (every caller, every writer and reader of the state I touch; a grep hit is not reading) and can say from the code what I changed and why that removes the bug. An unread file on the path means it is not done. Tests are Keiver's tool for checking my work, never my proof; a device run is his verdict, never a step I wait on.

- "Is it fixed?" gets yes or no, then the code path with file:line. Never "run it and see" or "the tests pass".
- Write the tests and run the ones the change touches. A green run is reported as a green run, never as the reason the fix works.

## Packages

Two npm workspaces (`packages/*` in the root `package.json`, symlinked into node_modules/@keiver). Dependencies point one way: app -> `@keiver/tomo-live` -> `@keiver/tomo-engine`. No package imports `@/` app code, and the engine never imports the live package; the test pins both.

- `packages/tomo-engine`: the on-device playback engine (FFmpeg, the `LocalRemuxer` and `LiveSources` native modules). Layout, build, FFmpeg and engine facts: `.claude/rules/tomo-engine.md`.
- `packages/tomo-live`: live TV over the engine (`LivePlayback`, the channel ring, previews, guide, the `LiveClipModule` Expo module). Layout: `.claude/rules/tomo-live.md`.
- The code is in the package: `services/playbackHold.ts`, `services/livePreview.ts`, `services/liveRing.ts` and `utils/guideMatch.ts` only re-export or wrap package symbols. Fix the package file.
- Versions: `npm run release:engine` / `npm run release:live` bump the version only; each package keeps its own `CHANGELOG.md`. Name a version with its package (`@keiver/tomo-engine@1.4.0`).

## Where the code lives

- Screen `app/player.tsx`. The `<Video>` lives in `components/player-host.tsx` (calls `useVideoPlayback`, draws `ImageSubtitleOverlay`), mounted once in `app/_layout.tsx` as `PlayerHost`, outside the navigator `Stack`, driven through `contexts/PlayerSessionContext.tsx` `usePlayerSessionHost`.
- Provider order in `app/_layout.tsx`: `AuthProvider` > `LoadingProvider` > `LibraryProvider` > `PlayQueueProvider` > `PlayerSessionProvider` > `LibraryFiltersProvider` > navigator.
- Playback state and open: `hooks/useVideoPlayback.ts` `useVideoPlayback`, with its pure helpers in `hooks/videoPlayback/`. Its reducer is `hooks/videoPlayback/machine.ts` `videoPlayerReducer`.
- Lane pick (direct, `localRemux` engine, server `transcode`): `hooks/videoPlayback/laneDecision.ts` `planLaneGates`, `selectLane`. A live channel picks the engine or nothing, never the server.
- Engine gate: `services/localRemux.ts` `canRemuxLocally` (every decline goes to the probe as a `decline` line), `predictPlaybackLane` (the item page and download planner's prediction, same gates), `startLocalRemux` (opens the session).
- Below-realtime memory: `services/engineVerdicts.ts` `rememberedVerdict`, `recordVerdict`. Server transcode permission: `services/transcodePolicy.ts` `serverTranscodeAllowed`.
- Jellyfin API: `services/jellyfinApi.ts` is a barrel over `services/jellyfin/*.ts`. Import network calls from `@/services/jellyfinApi`: 89 test files mock that specifier, and a direct `services/jellyfin/` import escapes the mock.
- Auth: `contexts/AuthContext.tsx` `AuthProvider`, `useAuth`; `services/jellyfin/auth.ts`, `services/jellyfin/accounts.ts`.
- Downloads: `services/downloads/manager.ts` `downloadManager`, `removeAll`.
- UI strings: `services/i18n/index.ts` `t`, catalogues in `services/i18n/locales/`.
- Tomo-only native modules: `native/ios/AudioQueuePlayer`, `native/ios/BookRenderer`, `native/ios/LyricsListener`, `native/ios/MultiAudioResourceLoader`, `native/ios/TopShelf`, `native/ios/TopShelfReload`, `native/ios/TunerGroups`. Each is copied in by its `plugins/with*.js` (Top Shelf: `plugins/withTopShelfExtension.js`); Swift tests in `native/ios/Tests/`, SwiftPM `native/ios/Package.swift`.
- Edit native sources in `packages/*/ios/` and `native/`, and project configuration in `plugins/` and `scripts/`, never the generated `ios/`, `macos/`, `tvos/` or `android/`.

## Before you touch X, read Y

- A playback lane, the engine, a codec, a transcode: `memories/CLAUDE-playback-engine.md` and `.claude/rules/tomo-engine.md`
- Tiers, ABR, the gateway, link measurement: `memories/CLAUDE-slipstream.md`
- Audio track switching: `memories/CLAUDE-multi-audio.md`
- A Jellyfin call: `memories/CLAUDE-api-reference.md`, then <https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json>
- A context or manager's state: `memories/CLAUDE-state-management.md`
- Credentials, SecureStore, app config: `memories/CLAUDE-configuration.md`
- A new screen or hook, folder structure: `memories/CLAUDE-patterns.md`
- A component, colour or design token: `memories/CLAUDE-components.md`
- expo-tvos-search or any dependency: `memories/CLAUDE-external-dependencies.md`
- Any tvOS focus/Menu/navigation design: `memories/CLAUDE-lessons-learned.md` and `git log -S`
- A playback failure, a failing suite, a device, Metro or build problem: `memories/CLAUDE-debugging.md`, then `memories/CLAUDE-lessons-learned.md`
- Accounts, profiles, PIN, user switching: `memories/CLAUDE-multiuser.md`
- Writing or changing tests: `memories/CLAUDE-testing.md`
- The playback suite or its fixtures: `test/playback/CLAUDE.md`
- Security: `memories/CLAUDE-security.md`
- Performance: `memories/CLAUDE-app-performance.md`
- Setup: `memories/CLAUDE-development.md`
- Icons, Top Shelf art: `memories/CLAUDE-tvos-icons.md`
- App Store copy, screenshots, naming, review notes, What's New: `memories/CLAUDE-apple-store-metadata.md` (its decisions of record come first)
- Roadmap or competitors: `memories/CLAUDE-roadmap.md`
- Reading a screenshot or image: `memories/CLAUDE-image-analysis.md`
- "Does Tomo support X?": `FEATURES.md`
- Signing, archive, Mac captures: `docs/RELEASING.md`

`memories/CLAUDE-lessons-learned.md` takes a new entry only when asked: one `## Note:` paragraph of confirmed facts (mechanism, fix with commit hash, rule).

## Product Decisions of Record (never re-propose)

- The server is a file host: on a link that carries the source (>= 1.2x its rate) no server rung or transcode is touched.
- The phone player is the PRESENTED AVKit player. No custom controls, overlay buttons or lib patches for player behaviour. Player-adjacent UI goes between episodes (`components/up-next-interstitial.tsx`), never over the presentation.
- Never add hunks to `patches/react-native-video+*.patch` for player behaviour; editing an existing hunk needs a go. Stay on RNV 6.19.2 until v7's podspec gains `:tvos`.
- `showNotificationControls={!Platform.isTV}` in `components/player-host.tsx` is load-bearing for the AirPlay dialog.
- tvOS Menu key = native pop, zero handlers.
- tvOS screens never get a native `UINavigationBar`. Ship TV layout changes behind `!Platform.isTV` from the first commit.
- On tvOS never render an absolutely positioned view above focusables (react-native-tvos forces `isUserInteractionEnabled`, `pointerEvents` cannot opt out). Inset shadows go on the container.
- NativeTabs triggers are fully static: never flip `hidden` or `disabled` at runtime.
- A presented `AVContentProposal` card has no JS dismissal: never arm it without a route that owns it.
- tvOS 26 info panel is a presented VC: dismiss it with `vc.dismiss`, never by flipping `showsPlaybackControls`.
- Audio-only PiP is impossible (AVKit gates on `hasVideo`). Dismissing the audio player keeps playing; the brief gap is accepted.
- Downloads are never removed by an auth/session event. The only route to `removeAll()` is the storage gauge long press.
- Never auto-logout on network failure. Recovery matches servers by stored `jellyfin_server_id`.
- Issue 73: explicit `Recursive=false` on every non-recursive `/Items` call. Shared library folders are unsupported by Jellyfin; no app-side scoping.
- Issue 76 (Touch Alternatives eats keys): no plist/defaults fix exists.
- No in-player remote subtitle search (Jellyfin returns empty for `Type: Video`). No Apple Watch app.

## Platform Facts

- Subtitles never route playback to the server. The lane is picked by codec, measurement or verdict; name that, never a fixture nickname.
- Jellyfin auth in URLs is `ApiKey=` (lowercase `api_key` 401s on Jellyfin 12). Never rename the SecureStore key `jellyfin_api_key`.
- Item ids are MD5(type + path): identical across servers. State keyed only by id survives a server switch; scope it to the session.
- Jellyfin attaches a sidecar only when its filename starts with the video's full filename then `.`.
- `isReadyForDisplay` never fires for audio-only; gate reveal on it only for video.
- Dolby Vision proof is only `hdrMode = Dolby` in Console.app (needs Match Dynamic Range on). The in-app DV badge proves nothing. Profile 7 converts in our FFmpeg, no libdovi.
- Atmos: the AirPods Control Center badge is conclusive when positive, not when negative.
- The flash before playback on Apple TV is Match Content; ask its setting before hunting open-time artifacts.
- Codec coverage claim: "59 of 110 allowlist prefixes proven through the real pipeline, zero failures", never "497 decoders". Probe with `npm run probe:codecs`, never `nm`.
- HTTP is allowed to all networks (HTTPS recommended for public servers: HTTP sends credentials in plaintext). Only Jellyfin servers are supported.

## Working Rules

Add 10 blank lines BEFORE and AFTER response text.

- A review reply is the verdict: "Nothing found" or the defects, one line each with file:line. A full review reads every changed file, checks `git log -S` before calling something a regression and whether a test asserts it before calling it a bug. The user's tested design choices are not bugs.
- Plain words, no jargon, in chat, test names, comments, commits and docs. No coined or pretty phrasing ("owed", "landing"). A test name says plainly what it checks.
- A question gets a prose answer and the turn ends; edits wait for a go. A "why" gets the measured finding and a proposal, then a stop.
- Never relitigate a settled claim. Say "I was wrong", never "what I meant was". Hold ground only on verified facts; cave only on evidence.
- Name our own regressions plainly: commit, mechanism, why nothing caught it. Never turn evidence the user already gave into a question.
- Never present a tangential bug as a discovery, invent problems from taste, or mention jest force-exit/test-hygiene noise.
- Never close with "not tested on device" or any untested caveat; the user's build/test/device process is never a gap. A device run on the named target is the verdict.
- Approved scope is literal ("restore the titles" = titles only). An unasked safeguard, guard script, lock or helper is slop; delete it on the first push-back. "Can we guard against X?" is a question.
- When the user names the fix, apply it site-wide at once, no root-cause hunt.
- Confirmed findings in a review/fix request get fixed and tested in the same turn, never offered as options. Same root cause at N sites = a failing test per site, then fix all N.
- A readiness evaluation, "what's new", research, agent run or `/loop` is READ-ONLY: findings, then wait for a go.
- Smallest change that removes the reported symptom; anything else found is one reported line. Copy/comment staleness can be fixed in-pass; runtime behaviour changes near a task wait for a go.
- Never remove or shrink a user-visible feature (clips, reels, bursts) for perf without asking; list every surface that reads the output first. Never remove a user capability (orientation, gestures) to dodge a library bug; use the native presentation instead.
- Never change user-visible strings, titles or SEO text unless that string is named. Grep `services/i18n/locales/` and `Settings` copy before calling behaviour a bug: what the copy describes is a design decision.
- Read a screenshot precisely: name the broken element and state first, fix only that.
- Exhaust app-altitude fixes using the library's own events before patching libraries or adding native surface. No private Apple APIs, ever.
- Type safety (no `any` without justification); try-catch around async operations.

## Shared Checkout, Builds and Devices

- Several sessions share this checkout. Re-run `git log --oneline -10` and `git status` before any review, doc or "the branch has X" claim.
- One commit per concern. Rename with `mv`, never `git mv`. After committing, `git log -1 --format=%(trailers)` prints nothing.
- Before any `git stash`/`pop`, check `git diff --quiet -- <files>`; never pop an entry that is not mine.
- Ask before mutating shared state: node_modules, patches (`patch-package --reverse`), lockfiles, caches.
- NEVER run `npm run prebuild`/`prebuild:tv`/`expo prebuild`, xcodebuild or archive. The user builds. Never caveat a native change with "needs a prebuild".
- Never `npm publish`, tag, or post to any registry or service. Never post PR/issue comments with `gh` (they post as the user); PR body edits on request are fine. Fix what a review comment raises before replying to it.
- PR bodies and CHANGELOG are terse and factual, list only what was measured, never verification gaps.
- Hands off booted sims and devices (`simctl openurl/io/launch`, `devicectl`) unless asked that turn. Never `process launch` on the TV while the user runs it from Xcode.
- While `npm run test:playback` runs, app source and the Jellyfin server are frozen.
- The personal Jellyfin (localhost:8096) is real media: reads any time, every write (library, path, user) asked per action.
- Kill only by explicit PIDs read from `ps -eo pid,etime,command`; never `pkill -f`/`pgrep -f` (Jellyfin's command line contains the ffmpeg path).
- Never write a username, home path or scratchpad path into a repo file, even for one run. Debug dumps go to `os.tmpdir()`.
- Fixtures are synthetic: no real library paths, volume names or titles.
- Test steps name concrete items from `test/playback/manifest.json`, never "any HDR10 file you have". Engineered repros are mine, ordinary-use logs are the user's.

## Testing

- While working, run only the tests the change touches: `npx jest <path>` for Jest; `swift test --package-path packages/tomo-engine --filter <TestClass>` (or `--package-path native/ios`) for Swift.
- `npm run test:engine` runs every Swift test in both packages (about 10 minutes). It is the release-final run: never during work and never as a review step.
- Specs live in `__tests__/` beside their target. Components are the grind: extract pure logic to a named export and test it. No snapshot tests.
- The `coverageThreshold` in `jest.config.js` only ratchets up, never down to green a run.
- No open-handle leaks: clear timers, `.unref()`, remove listeners.
- The `test`/`engine` CI checks on `main` stay required.

## Comments

None by default. Add one only for a constraint the code cannot show (a spec rule, an ordering invariant, a format quirk), one line, present tense. A docblock is at most 2 lines, an inline block 1, and comments stay under 5% of the lines a diff adds.

- Never write runtime behaviour claims (device, player, remote, OS, server, network): that is a measurement and goes in the commit message with how it was measured.
- Never paraphrase what an Apple or third-party API does unless grepped in the SDK header that turn; then name the header symbol.
- Never write pointers to other files, lines or callers, temporal framing ("now", "used to", "no longer", "this replaced Y"), justification blocks, or essays in data files (a `comment` field in a JSON fixture is a comment).
- When a diff touches a function, every comment in it is re-read against the new code and fixed in the same diff. A wrong comment gets the comment fixed, never the code.
- Never repeat a comment's claim to the user or into docs, store copy, CHANGELOG, a test name or another comment unless traced in code that turn; otherwise quote it as "the comment at file:line claims X, unverified". A runtime claim in a comment is confirmed only by a log, a measurement or the user's device run.

## Commands

```bash
npm start                 # Refreshes dev IP and starts Metro/Expo
npm run logs              # Stream native NSLog/os_log from the booted simulator
npx jest <path>           # The touched Jest tests
npm run lint              # ESLint and Prettier checks
npm run test:release      # Project and release script tests
npm run test:engine       # Every Swift test, release-final only (about 10 minutes)
npm run probe:codecs      # What the FFmpeg build registers
```

The user runs `npm run clear`, `npm run clearmac`, the `prebuild` scripts and `npm run archive -- <next-build>`. Schemes: `TomoTV-iOS`, `TomoTV-macOS`, `TomoTV-tvOS`; the Mac uses **My Mac (Mac Catalyst)**.

## End of Every Session: Keep These Files True

They load into sessions, so a stale line is a confident wrong answer. Before the session ends, update the file that owns the fact, in the same change, when the session:

- added, removed or renamed a package, a `native/ios/` module, a `memories/` file or a file or symbol named in any of them;
- changed which way the packages depend on each other;
- added an npm script worth naming, or changed what one does;
- settled a product decision or measured a platform fact worth keeping.

Then run `npx jest __tests__/claudeMd.test.ts`. It fails on a named path that no longer exists, an `npm run` script missing from `package.json`, a symbol missing from the file it is listed under, a package without its own rule file in `.claude/rules/`, a package, `native/ios/` module or `memories/` file this file does not name, and a package file that imports app code or imports against the dependency direction.
