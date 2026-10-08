# CLAUDE.md

## THE ULTIMATE RULE: NO PREDICTIONS. EVER.

Never act on, state, or commit anything derived from a prediction. Every claim
gets CONFIRMED first: read the code path, run the probe, research the source.
A claim about runtime state (a measurement, a cache, a server) gets checked,
never assumed. "It should" is banned; "measured/read/probed: it does" is the
only acceptable form.

- A plan is a claim. Every mechanism in it is measured before it ships; never defer it, refuse it, or list it as "open".
- A mechanism flagged as unconfirmed never ships, even when told "add the fix".
- Behaviour of a shipped app needs a run on a device, not a source read. SDK availability is not adoption.
- Code is the evidence. Comments, docs, commit messages and agent reports are claims under review.
- Provenance comes from `git log -S`, never one commit's diff.
- A finding is traced to a consequence at a file:line I opened, or it is not reported. Never float a failure hypothesis or forward an agent verdict untraced.
- Never assert Apple/native API names or availability from memory: grep the installed SDK headers or `xcrun swiftc -typecheck` a probe. Apple Developer Forums are never a source.
- Never say "cannot"/"impossible" before grepping the repo for an existing mechanism (e.g. `scripts/transcode-bench.mjs` already drives the Apple TV).
- Open every file my own search returned before theorizing about it.
- Confirming a defect is real is not confirming a fix is safe: find the invariant the current shape protects first.

**TomoTV** is a Jellyfin video streaming app built with React Native TVOS and Expo, targeting Apple TV (tvOS) and iOS. Playback runs through an on-device engine (packages/tomo-engine, the `@keiver/tomo-engine` workspace package: ios/LocalRemuxer + an owned FFmpeg build): H.264/HEVC stream-copy from any container, on-device transcode for the rest, Dolby passthrough, multi-audio switching, and image subtitles drawn over the native player. The server transcodes only true edge cases.

## Communication Format

Add 10 blank lines BEFORE and AFTER response text for visual breathing room in terminal.

- Short. Lead with the answer. Done work is one plain sentence: no lists, hashes, test counts or self-corrections unless asked.
- A review reply is the verdict: "Nothing found" or the defects, one line each with file:line.
- No em dashes anywhere: chat, commits, comments, docs, store copy. Grep every file I touched for U+2014.
- A question gets an answer in prose and the turn ends. Edits wait for a go. A "why" gets the measured finding and a proposal, then a stop.
- Never relitigate a settled claim: verify once, answer yes/no. If I was wrong, say "I was wrong", never "what I meant was".
- Never restate a mechanism the user already understood; build what they asked to hold.
- Hold ground only on verified facts; cave only on evidence.
- Name our own regressions plainly: commit, mechanism, why nothing caught it. Never turn evidence the user already gave into a question.
- Never present a tangential bug as a discovery, never invent problems from taste, never mention jest force-exit/test-hygiene noise.
- Never close a report with "not tested on device" or any untested caveat. When the user says it is tested, it is verified. A device run on the named target is the verdict.
- Never treat the user's build/test/device process as a gap or to-do.

## Scope

- Build exactly the ask, then stop. An unasked safeguard, guard script, lock or helper is slop; delete it on the first push-back.
- When the user names the fix, apply it site-wide at once, no root-cause hunt.
- Confirmed findings in a review/fix request get fixed and tested in the same turn, never offered as options. Same root cause at N sites = a failing test per site, then fix all N.
- A readiness evaluation, "what's new", research, agent run or `/loop` is READ-ONLY: findings, then wait for a go.
- Smallest change that removes the reported symptom. Anything else found on the way is one reported line, never applied.
- Copy/comment staleness can be fixed in-pass; runtime behaviour changes near a task wait for a go.
- Approved scope is literal ("restore the titles" = titles only).
- Fixing a test touches only its assertions/inputs: no harness additions, never the code under test.
- Never remove or shrink a user-visible feature (clips, reels, bursts) for perf without asking. List every surface that reads the output first.
- Never remove a user capability (orientation, gestures) to dodge a library bug; use the native presentation instead.
- Never change user-visible strings, titles or SEO text unless that string is named. Grep locale strings and `Settings` copy before calling behaviour a bug: what the copy describes is a design decision.
- No new dependency, icon family or font for a cosmetic change. Ionicons only.
- Stacked buttons share one width; hierarchy comes from fill/outline. Positional anchors (progress bars, badges) never move between states.
- Read a screenshot precisely: name the broken element and state first, fix only that.
- Before any tvOS focus/Menu/navigation design, read `memories/CLAUDE-lessons-learned.md` and `git log -S`. Never substitute the requested mechanism for an adjacent one.
- Never patch libraries or add native surface before exhausting app-altitude fixes using the library's own events. No private Apple APIs, ever.

## Shared Checkout, Builds and Devices

- The user runs several sessions in this checkout. Re-run `git log --oneline -10` and `git status` before any review, doc or "the branch has X" claim.
- Commit only on the user's go, only files this session touched, one commit per concern, never `git add .`/`-A`. Rename with `mv`, never `git mv`. No attribution trailers ever: `git log -1 --format=%(trailers)` prints nothing.
- Before any `git stash`/`pop`, check `git diff --quiet -- <files>`; never pop an entry that is not mine.
- Ask before mutating shared state: node_modules, patches (`patch-package --reverse`), lockfiles, caches.
- NEVER run `npm run prebuild`/`prebuild:tv`/`expo prebuild`, xcodebuild or archive on my own. The user builds. Never caveat a native change with "needs a prebuild".
- Never `npm publish`, tag, or post to any registry or service. Never post PR/issue comments with `gh` (they post as the user); PR body edits on request are fine. Fix what a review comment raises before replying to it.
- PR bodies and CHANGELOG are terse and factual, list only what was measured, never verification gaps.
- No pipeline locks, guards or scripts unless asked; "can we guard against X?" is a question.
- Hands off booted sims and devices (`simctl openurl/io/launch`, `devicectl`) unless asked that turn. Never `process launch` on the TV while the user runs it from Xcode.
- While `npm run test:playback` runs, app source and the Jellyfin server are frozen.
- The personal Jellyfin (localhost:8096) is real media: reads any time, every write (library, path, user) asked per action.
- Kill only by explicit PIDs read from `ps -eo pid,etime,command`; never `pkill -f`/`pgrep -f` (Jellyfin's command line contains the ffmpeg path).
- Never write a username, home path or scratchpad path into a repo file, even for one run. Debug dumps go to `os.tmpdir()`.
- Fixtures are synthetic: no real library paths, volume names or titles.
- Test steps name concrete items from `test/playback/manifest.json`, never "any HDR10 file you have". Engineered repros are mine, ordinary-use logs are the user's.

## Product Decisions of Record (never re-propose)

- The server is a file host: on a link that carries the source (>= 1.2x its rate) no server rung or transcode is touched. Design: `memories/CLAUDE-slipstream.md`.
- The phone player is the PRESENTED AVKit player. Native chrome is the moat: no custom controls, no overlay buttons, no lib patches for player behaviour. Player-adjacent UI goes between episodes (`components/up-next-interstitial.tsx`), never over the presentation.
- Never add hunks to `patches/react-native-video+*.patch` for player behaviour; editing an existing hunk needs a go. Stay on RNV 6.19.2 until v7's podspec gains `:tvos`.
- `showNotificationControls={!Platform.isTV}` in app/player.tsx is load-bearing for the AirPlay dialog.
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
- No in-player remote subtitle search (Jellyfin returns empty for `Type: Video`). No Apple Watch app. iOS 27 Generated Subtitles stay out of copy until approved.
- App Store screenshots: iPhone/iPad portrait only, tvOS landscape. 1320x2868 goes in the hidden 6.9" slot. Caption band: gold #FFC312, ink #2B1F05, Space Grotesk SemiBold.
- Naming "Tomo TV, a Jellyfin Client" is the branding doc's own example: never propose a rename or logo change.
- App Review Notes must be filled for any new platform submission; adding a platform is a new-app review.
- App Store What's New: a few short lines, one user benefit each, in the viewer's words. No internals (engine, codecs, M3U/playlist, focus targets, row counts, timings) and no niche fixes; those stay in CHANGELOG.

## Engine and Platform Facts

- Subtitles never route playback to the server. The lane is picked by codec, measurement or verdict; name that, never a fixture nickname.
- The engine's session anchor is the first keyframe it sees: the first generation MUST open at position 0. Move the segment index, never the clock.
- Per-pixel/per-sample realtime loops belong in the -O2 FFmpeg frameworks, never app-target Swift (Debug runs ~300x slower).
- Engine sources live in `packages/tomo-engine/ios/{LocalRemuxer,LiveSources}`; the TomoEngine pod and `packages/tomo-engine/Package.swift` glob them, so a new file needs no registration. Tomo-only native files stay in `native/ios/` and are copied by their plugin.
- Native changes: `swift build --package-path packages/tomo-engine` and `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npm run test:engine` before "done".
- Any Swift file subclassing RCTEventEmitter needs a literal `import React`.
- Jellyfin auth in URLs is `ApiKey=` (lowercase `api_key` 401s on Jellyfin 12). Never rename the SecureStore key `jellyfin_api_key`.
- Item ids are MD5(type + path): identical across servers. State keyed only by id survives a server switch; scope it to the session.
- Jellyfin attaches a sidecar only when its filename starts with the video's full filename then `.`.
- Reanimated worklet helpers are not hoisted: define them above their callers.
- tvOS simulator has no HEVC decoder: an `encode hevc` plan failing at 0.0s on the sim is judged on a device.
- `isReadyForDisplay` never fires for audio-only; gate reveal on it only for video.
- Dolby Vision proof is only `hdrMode = Dolby` in Console.app (needs Match Dynamic Range on). The in-app DV badge proves nothing. Profile 7 converts in our FFmpeg, no libdovi.
- Atmos: the AirPods Control Center badge is conclusive when positive, not when negative.
- The flash before playback on Apple TV is Match Content; ask its setting before hunting open-time artifacts.
- Codec coverage claim: "59 of 110 allowlist prefixes proven through the real pipeline, zero failures", never "497 decoders". Probe with `npm run probe:codecs`, never `nm`.
- Before changing the HLS master shape, read Apple's HLS authoring spec appendixes, not only RFC 8216.

## Debugging Order

- Playback failure: Jellyfin log (`~/Library/Application Support/jellyfin/log/`, grep the item id, newest `FFmpeg.*-<id>` log) and the item Path first, then app code.
- Continue Watching "missing": grep the app log for `CW row fetch` and `Auth credentials saved` to confirm the account.
- Whole playback suite failing: the app is signed into another server. `xcrun simctl spawn <udid> log show --last 45m --predicate 'process == "TomoTV"' | grep -o -E "url: https?://[^/]+" | sort | uniq -c`. Never pipe the run through `tail`.
- Device cannot reach Metro: check the macOS firewall for the current node binary (`scripts/check-firewall.sh`), then VPN on the phone.
- AVPlayer -1001 on every LAN URL on the Apple TV while the engine plays: reboot the TV.
- Top Shelf showing stale/static content after reinstall: fresh install and reboot before suspecting code.
- Build failure: read the `.xcactivitylog` in DerivedData, not only the pasted errors.
- `log` is aliased to `git log` in this shell: use `/usr/bin/log show`.
- Link speed ground truth is the server NIC's tx_bytes or Cloudflare `__down`, never the Mac.
- Console.app is `-0500`, the JS logger is `Z`.
- Device logs: `xcrun devicectl device process launch --console --payload-url "tomotv://player?videoId=<id>&probe=1" dev.keiver.tomotv` (only when asked).
- Sign a sim into any server: `tomotv://dev-session?...` (dev builds), then route links like `tomotv:///settings`. macOS 27 has no Simulator.app: drive the tvOS sim with `simctl openurl`, the Metro inspector and lldb `UIFocusDebugger`.
- JS thread profiling: Metro inspector at `http://localhost:8081/json` with `Origin: http://127.0.0.1:8081`, `Tracing` domain.

## Testing (standing work, every session)

- The jest `coverageThreshold` only ratchets up, never down to green a run.
- Components are the grind: extract pure logic to a named export and test it. No snapshot tests.
- No open-handle leaks: clear timers, `.unref()`, remove listeners.
- The `test`/`engine` CI checks on `main` stay required.

## Memory Bank Keyword Index

Load these files automatically when mentioned:

**Implementation:**

- "API" / "jellyfinApi" / "functions" -> `memories/CLAUDE-api-reference.md`
- "state" / "manager" / "context" -> `memories/CLAUDE-state-management.md`
- "audio tracks" / "multi-audio" -> `memories/CLAUDE-multi-audio.md`
- "config" / "credentials" / "SecureStore" -> `memories/CLAUDE-configuration.md`
- "pattern" / "how do I" / "example" -> `memories/CLAUDE-patterns.md`
- "external" / "expo-tvos-search" / "dependencies" -> `memories/CLAUDE-external-dependencies.md`
- "lessons" / "bug" / "debugging" -> `memories/CLAUDE-lessons-learned.md`
- "multiuser" / "profiles" / "user switching" / "accounts" / "PIN" -> `memories/CLAUDE-multiuser.md`
- "engine" / "remux" / "codec" / "transcode" / "deinterlace" / "swscale" -> `memories/CLAUDE-playback-engine.md`
- "slipstream" / "adaptive" / "ABR" / "variants" / "gateway" -> `memories/CLAUDE-slipstream.md`

**Testing and Components:**

- "testing" / "tests" / "coverage" / "jest" -> `memories/CLAUDE-testing.md`
- "playback suite" / "test:playback" / "fixtures" / "development-videos" -> `test/playback/CLAUDE.md`
- "components" / "UI" / "design system" -> `memories/CLAUDE-components.md`

**Security and Performance:**

- "security" / "audit" / "vulnerability" -> `memories/CLAUDE-security.md`
- "performance" / "optimization" / "slow" -> `memories/CLAUDE-app-performance.md`

**Development and Deployment:**

- "setup" / "install" / "development" -> `memories/CLAUDE-development.md`
- "icons" / "tvOS icons" / "top shelf" -> `memories/CLAUDE-tvos-icons.md`
- "App Store" / "metadata" / "screenshots" / "submission" / "review notes" -> `memories/CLAUDE-apple-store-metadata.md`
- "roadmap" / "competitors" / "2.1" / "3.0" / "Infuse" / "Swiftfin" -> `memories/CLAUDE-roadmap.md`

**Other:**

- "image" / "vision" / "screenshot analysis" -> `memories/CLAUDE-image-analysis.md`
- "Jellyfin API" / "server API" -> Official API docs at <https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json>
- "architecture" / "tech stack" / "folder structure" -> `memories/CLAUDE-patterns.md` (Architecture Reference section)
- "color" / "palette" / "design tokens" -> `memories/CLAUDE-components.md` (Design System section)

## Lessons Learned

`memories/CLAUDE-lessons-learned.md` holds case studies. Add an entry only when asked: one `## Note:` paragraph of confirmed facts (mechanism, fix with commit hash, rule). No status write-ups after shipping.

## Development Commands

```bash
npm start                         # Refreshes dev IP and starts Metro/Expo
npm run logs                      # Stream native NSLog/os_log from the booted simulator (second pane beside npm start)
npm run ios                       # Build and run on iOS simulator
npm test                          # Run all tests once
npm run test:watch                # Watch mode for tests
npm run test:coverage             # Generate coverage report
npm run lint                      # Lint and auto-fix with ESLint
npm run prebuild                  # Clean native prebuild (user runs it)
npm run prebuild:tv               # Prebuild with Apple TV support, EXPO_TV=1 (user runs it)
```

## Native Code Development

**CRITICAL: Always edit files in `packages/tomo-engine/ios/`, `native/` and `plugins/`, NOT `ios/` or `android/`.** Prebuild deletes and regenerates `ios/`/`android/`, copies Tomo's native sources from `native/ios/` and links the engine as the TomoEngine pod.

## Code Quality Standards

- Type safety (no `any` without justification)
- Error handling (try-catch around async operations)
- No scale animations on grid items (performance rule)
- No over-engineering, no premature abstraction
- Edit repo files with the Edit tool only, never sed/python/heredoc rewrites; show the diff.

### Comments: 1-2 lines, present tense

Say the constraint or the non-obvious "why", then stop. Cut anything a reader can get from the code itself. Hard ceilings: a docblock is 3 lines, an inline block is 2, and comments stay under 15% of the lines a diff adds. Over the ceiling, delete before rewriting.

Never write:

- **Temporal framing**: "now", "used to", "no longer", "previously", "the old X", "this replaced Y". When behaviour changes, DELETE the comment describing the old behaviour.
- **Justification blocks** defending a choice or explaining what could not be done. That belongs in the commit message.
- **Essays in data files.** A `comment` field in a JSON manifest or fixture is still a comment.
- **Restated call graphs.** A caller list is wrong the day someone adds a caller.

### Reviewing: comments are what is under review, never the evidence

A full review reads every changed file and runs `npm run test:engine` before reporting once. Open the call path before repeating any claim a comment or commit message makes. Check `git log -S` before calling something a regression and whether a test asserts it before calling it a bug. The user's tested design choices are not bugs. Every finding names a file:line that was actually opened, or it does not ship.

## Known Issues

1. The on-device engine (packages/tomo-engine/ios/LocalRemuxer) plays H.264/HEVC in any container by stream copy, and everything else the linked FFmpeg decodes by VideoToolbox transcode, any bit depth, interlaced or not, audio-only files included. Subtitles send nothing to the server: text tracks ship as selectable HLS renditions, image tracks (PGS, DVD/VobSub, DVB, XSUB) are decoded on device to timed bitmaps the app draws over the native player. Server-side transcoding remains for codecs the build cannot decode and for files this device measured itself running below realtime on (the engine times segment 0 before the player is bound; `services/engineVerdicts.ts` remembers the file). We build FFmpeg ourselves (`scripts/ffmpeg/build.sh`, published by `.github/workflows/build-ffmpeg.yml`, fetched by `packages/tomo-engine/scripts/fetch-ffmpeg.js`) with every native decoder enabled, 520 of them, versus the 60 MPVKit's prebuilt allowlist left on, so DivX 3, Theora, DV, Cinepak and VVC all decode on device. `npm run probe:codecs` prints what the build actually registers. **Decision tree, allowlists and rationale: `memories/CLAUDE-playback-engine.md`**
2. HTTP allowed to all networks; HTTPS recommended for public servers (HTTP exposes credentials in plaintext)
3. Only works with Jellyfin servers (not Plex, Emby, etc.)
