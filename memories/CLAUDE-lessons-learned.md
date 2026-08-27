# Lessons Learned

**Last Updated:** August 4, 2026

## Quick Reference

**Category:** Implementation
**Keywords:** debugging, bugs, lessons, case studies, audio tracks, HLS, platform behavior, compliance tests, anti-patterns

Case studies of significant bugs encountered during TomoTV development with root causes, solutions, and key takeaways.

## Related Documentation

- [`CLAUDE-patterns.md`](./CLAUDE-patterns.md) - Lessons inform best practices
- [`CLAUDE-multi-audio.md`](./CLAUDE-multi-audio.md) - Audio track debugging cases

---

This document captures important lessons from debugging sessions, bugs, and issues encountered during TomoTV development. Each lesson reinforces the workflow and decision-making rules in the main CLAUDE.md.

---

## Note: CocoaPods Is a Global Tool and a Clean Mac Has None (August 2026)

`prebuild:dual` calls a bare `pod install`, and a wiped machine (macOS 26, fresh Homebrew, only Apple's Ruby 2.6.10) has no `pod`, so `npm run clear` dies at `sh: pod: command not found` before Expo's own installer can run (it only runs inside a prebuild without `--no-install`, the second one in that chain). Expo's first attempt, `gem install cocoapods` on system Ruby, cannot work there either: RubyGems 3.0.3 resolves activesupport 7.2.3.2 (Ruby >= 3.1.0) into /Library/Ruby/Gems. The Homebrew formula ships its own Ruby, so `scripts/check-cocoapods.sh` in `postinstall` runs `brew install cocoapods` whenever `pod --version` fails (measured: 0.35 s no-op afterwards, tvOS `pod install` green on Homebrew Ruby 4.0.6). A Gemfile would only move the global prerequisite from CocoaPods to Ruby >= 3.1. Same fresh Mac: `xcode-select -p` returns CommandLineTools with Xcode.app installed; `pod install` merely warns (`Unexpected XCode version string ''`, react-native/scripts/cocoapods/utils.rb:451), the build needs `sudo xcode-select -s /Applications/Xcode.app`.

## Note: expo-image contentPosition Blanks the Image on Large Crops (August 2026)

Any non-center `contentPosition` on iOS expo-image can render NOTHING: `applyContentPosition` (node_modules/expo-image/ios/ImageView.swift) moves the container-filling `sdImageView` layer by an offset computed from the cover-scaled CONTENT size, so the shift grows with crop overflow and pushes the whole clipped view out of frame. `"top center"` on the video-info hero blanked every poster-fallback item in landscape (2:3 posters even in portrait: offset ≈ half the overflow, ~200pt); it only ever looked right when the crop was near zero, which is also why `"center"` (offset 0) always works. Diagnosis path that worked: same image portrait-vs-landscape flip isolated layout from loading, backdrop-vs-poster items isolated the prop, then the lib source gave the mechanism. Use center-crop only, or size the image box explicitly and anchor it with layout.

## Note: tvOS PiP Is Gated on hasVideo — Audio-Only Can Never PiP (August 2026)

AVKit enables the tvOS PiP button off `-[AVPlayerController isPictureInPicturePossible]`, whose compiled logic requires `hasVideo`/`hasEnabledVideo` (KVO deps: pictureInPictureSupported, status, hasVideo, hasEnabledVideo, streaming, bestAvailableVideoResolution/Range, playingOnExternalScreen). No delegate, MPNowPlayingSession, audio-session, or AVPlayer-vs-AVQueuePlayer configuration can surface PiP for an audio-only stream; only a real video track can. Verified by disassembling the tvOS 26.5 simruntime AVKit (`llvm-objdump` on `.../RuntimeRoot/System/Library/Frameworks/AVKit.framework/AVKit` — full arm64 binary, not a stub; its `keyPathsForValuesAffecting…` methods list gating inputs as CFString refs). A delegate-wired implementation was built, device-refuted, and removed (8250ac5, then reverted); mp4 rips and music videos keep PiP because they carry video and route to the video player. Before wiring any AVKit affordance, find the `isXPossible` gate in the simruntime binary first — the transport bar binds to it.

## Note: Pushing a Tab-Nested Route From a Root Screen Duplicates (tabs) (August 2026)

`router.push("/[folderId]")` while a ROOT route (e.g. /video-info) is focused does not descend into the library stack: expo-router's `findDivergentState` compares the action against the root stack's FOCUSED route, the names differ, and the PUSH targets the root navigator — StackRouter PUSH always appends a new instance, so a duplicate `(tabs)` lands on top of the root stack with its own fresh library stack. Menu then can't walk the folder levels (the parent folder lives in a sibling navigator instance) and the tab bar claims the press. This is why Show in Folder pops the info panel on BOTH platforms before pushing; the hook's awaited ancestor fetch guarantees the pushes run after the pop commits. Rule: only push tab-nested routes while `(tabs)` is the focused root route — pop any root screen first.

## Note: AVKit Pauses the Player on Dismissal, and Only tvOS Can Hear It Coming (August 2026)

Dismissing a presented AVPlayerViewController pauses its player, so background audio needs the state sampled before the dismissal and re-asserted after. tvOS samples in `playerViewControllerShouldDismiss`; iPhone cannot, because `AVPlayerViewController.h:429,437,445` marks that method and both dismissal-transition callbacks `API_UNAVAILABLE(ios)`, so it samples in the subclass's own `viewWillDisappear` (verified to run before AVKit's, which only logs and calls super). No public property turns the pause off: `canPausePlaybackWhenExitingFullScreen` gates it and is SPI, in the runtime headers since iOS 12 and in no SDK header. AVKit issues the pause from its dismissal transition's COMPLETION block, so a single resume at `viewDidDisappear` races it and the resume is asserted twice. The brief audible gap is that pause-then-resume and is expected on both platforms.

## Note: Views Above Focusables Kill tvOS Focus (August 2026)

Never absolutely position any view above focusable items on tvOS, even decorative ones: react-native-tvos hard-codes `isUserInteractionEnabled = YES` on plain Fabric views, so the focus engine treats every covering sibling as occlusion and `pointerEvents: "none"` cannot opt out (it only affects touch, which is why iPhone masks the bug). For sunken-card looks, put the inset `boxShadow` on the container and make row backgrounds transparent. Diagnose with lldb on the sim app: `[UIFocusDebugger checkFocusabilityForItem:]` names the occluder.

## Note: A Native Navigation Bar Is Not Usable on tvOS (August 2026)

Do not give a tvOS screen a `UINavigationBar`, whatever the SDK says is available. The Apple TV
folder grid was given `headerShown: true` with a title and a `unstable_headerRightItems` Filters
button, and on device the title landed centred in the upper third over the artwork while the bar
button rendered as a stray glyph the remote could not reach at all. Reverted the same day; phone
keeps the native bar, TV keeps its in-grid bar (`components/library-header.tsx`) and the focus
machinery that goes with it.

What made this look safe and was not enough: the tvOS 26.5 SDK headers do expose
`UINavigationBar`, `UINavigationItem.title` and `rightBarButtonItems` with no `API_UNAVAILABLE(tvos)`
(only `backBarButtonItem`, `hidesBackButton` and the large-title/search properties are compiled
out), and `react-native-screens` runs its header config on tvOS unguarded
(`RNSScreenStackHeaderConfig.mm:507-700`). Availability is not adoption: tvOS has no navigation-bar
design language, so UIKit lays the bar out and the focus engine ignores its items. The pattern to
keep is the one that was already there, a bar drawn inside the screen's own focusable content.

Two rules out of it. Apple TV layout and focus questions are answered on a device, never from header
availability plus library source. And when a change spans both platforms, a per-platform kill switch
(`headerShown: !Platform.isTV`) is worth having from the first commit, because the revert then costs
one expression instead of a file restore.

---

## Note: A Docblock Claimed a Type Gate the Code Never Had (August 2026)

Issue #68: every tagged song badged `S01E01`. Jellyfin fills an Audio item's `IndexNumber`
with the track and `ParentIndexNumber` with the disc (`AudioFileProber.cs:378-385`,
corroborated by `Audio.cs:96-97` sorting disc-then-track), and `formatSeasonEpisode`'s
both-fields-present branch had no `Type` check — while its own docblock asserted "audio
tracks carry IndexNumber as the track number". Only the _second_ branch and one regex tier
were actually gated, so the docblock read as coverage the code never implemented and the
gap survived review. A second, unnoticed path went with it: a song merely _named_
"Live S01E05 Session" matched `SEASON_EPISODE`, which the old `isAudio` local did not guard.

Two things this cost, worth repeating: the bug was invisible locally because every Audio
item on the dev server (and on both public Jellyfin demos) has null index fields, so it
took a purpose-built disc-tagged fixture library to reproduce; and the partial gate is the
signature to look for — when one branch of a function checks `Type` and its sibling does
not, the docblock is describing intent, not behaviour. Read the branch, not the paragraph.

---

## Playback Reporter Write Races Corrupt Server Resume State (August 2026)

### Problem

Continue Watching kept losing/corrupting items after failed playbacks: a resume session that stalled and was backed out removed the item from the row (morning incident, Stopped at 1319ms), and later the same episode resumed from 2628.93s when the user had left it at 1043.25s — a position they never watched. Survived clean installs (corruption is server-side), not file-specific.

### Root Cause (two layers; the first fix shipped was only the second layer)

1. **Reporter write races (the primary defect, all JS, this branch's playback-reporting feature).** Three unsynchronized fire-and-forget write streams (Sessions Progress, Sessions Stopped, gate-free UserData persists) with no ordering: PROVEN by artifact — the back-out's Stopped carried 2767.75s (Jellyfin log 12:45:07) but the DB ended at 2728.58s, the 8s-poll persist from BEFORE the stop, and the back-out's own final persist never landed at all. Jellyfin's Sessions gates then convert bad positions into removals: below MinResumePct (5%) zeroes the resume point, above MaxResumePct (90%) marks played — either drops the item from /Items/Resume. Also latent: reports were built from `videoIdRef.current`, which render mutates BEFORE the previous session's effect cleanup fires, so same-instance videoId changes (queue advance via router.replace) could stamp the old session's clock under the new item's id (impossible-duplicate music Stopped reports in the server log carried this signature).
2. **LocalRemux seek starvation (secondary, native).** A stranded segment request 404s a VOD-promised segment after segmentURL's 20s deadline; AVPlayer silently abandons the seek and snaps to the preroll buffer at ~0 — no onError. That snapped clock is where the morning's 1319ms Stopped came from. Fixed in Remuxer.swift (waiter re-assert, waiter-aware throttle, rw_timeout, NSLog diagnostics).

### Solution

`hooks/usePlaybackReporter.ts` rewritten around two invariants: (1) ONE serialized write chain — every server write queues in program order, spanning sessions, so a stale mid-session persist can never land after the session-closing Stopped; (2) a session is a frozen snapshot ({itemId, mediaSourceId, playSessionId, playedAtStart} captured at markStarted) that closes exactly once — closed sessions accept no writes (gate checked after every await), and the closing persist retries once (`updateUserItemData` now returns a success boolean). Regression tests cover cross-item identity, stale-persist-after-close, single-close, and the retry.

### Key Takeaways

1. **Fire-and-forget server writes need an ordering discipline.** Any state that multiple async paths write must go through one serialized pipeline with close-once semantics; "sequential awaits inside each path" does not order writes ACROSS paths.
2. **Session identity must be snapshotted at session start.** Render-time ref mutation + cleanup-after-render means live refs belong to the NEXT session by the time teardown code runs.
3. **The server DB/log is the ground truth for "what did the app send".** When the dev Jellyfin is local, read its DB (sqlite, read-only) and request log before theorizing; positions with raw JS float precision identify app UserData writes vs Jellyfin's own ms-rounded writes.
4. **AVPlayer abandons unfulfillable seeks silently** (404 on a VOD-declared segment → snap to buffered content, no onError). The native serving contract must produce every promised segment or fail loudly.
5. **Absence of log lines is evidence.** The poll's delta/equality guards make silence informative enough to reconstruct the playhead timeline.

### Files Affected

- `hooks/usePlaybackReporter.ts` (serialized write chain, session snapshot, close-once, retry)
- `services/jellyfinApi.ts` (`updateUserItemData` returns success boolean)
- `native/ios/LocalRemuxer/Remuxer.swift` (waiter re-assert, waiter-aware throttle, rw_timeout, diagnostics — committed earlier in 8ae8552)

---

## tvOS Menu Backgrounds the App on the Audio Player (July 2026)

### Problem

On Apple TV, pressing Menu on the player while an AUDIO file played suspended the app to the home screen ("app closes, unrecoverable"). Video playback popped back to the folder correctly. Same player component for both.

### Root Cause

A pushed react-native-screens screen pops on Menu ONLY when tvOS focus sits inside it — no library implements the pop (react-native-screens has zero Menu handling; react-native-tvos ships its menu recognizer disabled); it is UIKit walking the FOCUSED view's responder chain to the navigation controller. Video's AVPlayerViewController transport UI is focusable, so focus lives in the screen and Menu pops. Audio-only playback renders no focusable UI at all (AVKit's audio presentation exposes none; the poster overlay is `pointerEvents="none"`), so focus was stranded, the press reached nothing, and the system default applied: background the app. Surfaced by the fullScreenModal → push change (`e0b30bb`): modal dismissal on Menu never depended on focus, so audio worked as a modal and broke as a push.

### Solution

An invisible absolute-fill focus anchor (the library-grid `focusHolder` pattern) rendered on the player only for `Platform.isTV && isAudioOnly`. Focus stays in the pushed screen, Menu pops natively, zero menu handlers.

### Key Takeaways

1. **A pushed screen pops on Menu only if something in it is focusable** — every fullscreen tvOS screen needs at least one focusable view (visible control or invisible holder); "no focusable content" reads as "Menu quits the app"
2. **Menu handling remains zero-JS** (e136575 stands); when Menu misbehaves, fix the focus environment, not the event routing
3. **Presentation mode changes shift Menu semantics**: modal dismissal is focus-independent, stack pop is focus-dependent — retest every media type after such a change
4. **Verify event-delivery mechanics in library source before writing a handler for them**

### Files Affected

- `app/player.tsx` (audio-only focus holder; stack-rule comment updated)

---

## Static NativeTabs Triggers + Auth-State Convergence (July 2026)

### Problem

Three symptoms from one design flaw: (1) a border of dead space around tab screens after revealing the hidden Search trigger at login (until relaunch); (2) after switching the trigger to `disabled`, tvOS focus-selected the tab and then ejected back (visible race); (3) after making triggers static, signing out left the Library tab showing the logged-in content, and an expired token (401, demo server resets) stranded the user on a raw error screen instead of the disconnected state.

### Root Cause

NativeTabs (expo-router / react-native-screens) triggers cannot change at runtime on tvOS: `hidden` drops the route and remounts the whole navigator (remounted screens get stale, inset native frames), and `disabled` only suppresses the tap path, not tvOS focus-driven selection. The old `hidden` flip also masked missing state handling: the navigator remount incidentally reset every screen on login/logout, so nothing else knew how to react to auth changes.

### Solution

1. Tab triggers are fully static; the Search screen renders the logged-out state itself (the exact Library disconnected view: same `LibraryGrid` + `useFolderContents(null)`).
2. `useFolderContents` subscribes to auth changes and refetches on every transition, both directions: login loads the new server, logout fails the fetch and replaces stale content with the disconnected error.
3. A 401 on any authenticated data request triggers a one-shot `handleUnauthorized()` sign-out in `jellyfinApi` (`throwRequestError`), so a dead token converges every screen to the same fresh-install state. Auth flows (login, Quick Connect, demo validation) keep their own 401 handling.

### Key Takeaways

1. **NativeTabs triggers must be static on tvOS** — never flip `hidden` or `disabled` at runtime; handle conditional UX inside the screen
2. **If a navigator remount was resetting your state for free, removing the remount surfaces every missing state transition** — audit login AND logout paths
3. **Auth-state convergence beats per-screen error handling** — one sign-out path (explicit, or forced by 401) that every screen reacts to via subscription

### Files Affected

- `app/(tabs)/_layout.tsx`, `app/(tabs)/search.tsx`, `app/(tabs)/(library)/index.tsx`
- `hooks/useFolderContents.ts` (auth-change refetch)
- `services/jellyfinApi.ts` (`handleUnauthorized`, `throwRequestError` at 15 data call sites)

---

## UIHostingController Containment Bug — .searchable Keyboard Disappears (February 2026)

### Problem

After interacting with any TextInput on the Settings tab (which opens a tvOS keyboard dialog/UIAlertController), navigating to the Search tab caused the native `.searchable` SwiftUI keyboard to stop appearing entirely. Fresh app launches worked fine.

### Root Cause

In `expo-tvos-search`, the `UIHostingController` hosting the SwiftUI `NavigationView` with `.searchable` was created and its **view** was added as a subview, but the controller itself was never added as a child view controller via `addChild`/`didMove(toParent:)`. This meant:

- The hosting controller never received `viewWillAppear`/`viewDidAppear` lifecycle events
- SwiftUI's `.searchable` modifier relies on UIKit's focus system integration, which requires proper VC containment
- It worked "by accident" on fresh launch (no prior focus state to conflict with)
- After a Settings TextInput opened a UIAlertController (keyboard dialog), UIKit's focus engine state changed, and returning to Search, the focus engine couldn't route focus back to `.searchable` because the hosting controller wasn't in the VC hierarchy

### Solution

Added proper UIKit view controller containment in `ExpoTvosSearchView.swift`:

1. `didMoveToWindow()` override — when view enters a window, find nearest parent VC via responder chain and call `addChild`/`didMove(toParent:)`. When removed, call `willMove(toParent: nil)`/`removeFromParent()`
2. Early containment in `setupView()` for cases where the view already has a window at setup time
3. Cleanup in `deinit` to remove VC relationship

### Key Takeaways

1. **UIHostingController requires proper child VC containment** — adding just the `.view` as a subview is not sufficient. Without `addChild`/`didMove(toParent:)`, SwiftUI never receives lifecycle events
2. **"Works on first launch but breaks after X" is a containment/lifecycle smell** — if something works initially but breaks after unrelated UIKit interactions, suspect missing lifecycle integration
3. **Focus engine bugs on tvOS are often VC hierarchy bugs** — the tvOS focus engine relies on the view controller hierarchy to route focus. If a VC isn't in the hierarchy, its views can't participate in focus updates

### Files Affected

- `expo-tvos-search/ios/ExpoTvosSearchView.swift` (library fix)
- `app/(tabs)/settings.tsx` (defensive cleanup, kept but not the fix)

---

## Note: AVKit Prefers LANGUAGE Over NAME, so "und" Renders as "Unknown language" (January 2026)

iOS and tvOS always display an HLS audio rendition's LANGUAGE attribute over its NAME, so `LANGUAGE="und"` shows Apple's own localized "Unknown language" whatever NAME says. LANGUAGE is OPTIONAL per RFC 8216, so omitting it entirely on undefined-language tracks makes the picker fall back to NAME (`native/ios/MultiAudioResourceLoader/HLSManifestGenerator.swift:156-180`, 703c7a2). Display and auto-selection are separate pairs: LANGUAGE/NAME drive what the picker shows, DEFAULT/AUTOSELECT drive what plays. Generic HLS specs define what is allowed; only Apple's HLS Authoring Specification and the shipped Swift define what happens.

## Compliance Test Anti-Pattern (January 2026)

### Problem

AI-generated tests sometimes use `fs.readFileSync` to scan source code files and assert on string presence/absence, rather than testing actual runtime behavior. These "compliance tests" provide false confidence and test nothing meaningful.

### Root Cause

When asked to verify a code property (e.g., "ensure no console.log statements"), the path of least resistance is to read the source file and check for string patterns. This satisfies the request superficially but doesn't exercise any code paths.

### Solution

Established a rule: **all tests must exercise actual code paths.** If the only way to verify something is scanning source text, use a linter rule instead or skip the test entirely. No test is better than a fake test.

### Key Takeaways

1. **Tests must exercise code paths:** A test that reads source files is not a test — it's a linter with extra steps
2. **No test > fake test:** If you can't write a meaningful behavioral test, skip it
3. **Right tool for the job:** Use ESLint for code style enforcement, Jest for behavior verification
4. **Question AI-generated tests:** Compliance tests are a common AI failure mode — always review test quality, not just quantity

### Files Affected

- `memories/CLAUDE-testing.md` (added No Compliance Tests rule)
- No existing test files were in violation

---

## False Apple Docs Claim in tvOS Focus Fix (January 2026)

### Problem

Implemented a tvOS focus restoration function based on an unverified claim about Apple's documentation. The code comment stated "Per Apple docs, UIKit rebuilds the focus spatial map when a focusable view is removed from the hierarchy." This claim was false.

### Root Cause

The plan stated an Apple docs fact that was never verified. The implementation was coded, commented, and JSDoc'd with "Per Apple docs" without anyone checking what Apple actually says. What Apple actually says: "UIKit automatically updates focus when a **focused** view is removed from the view hierarchy." The word "focused" is critical — it means the currently-focused view, not any arbitrary focusable view. Additionally, Apple doesn't use the term "spatial map" at all.

### Solution

Verification showed the claim was false. The implementation (adding/removing a non-focused temporary focusable view) is almost certainly a no-op — UIKit has no reason to do anything when a view that never had focus is removed.

### Key Takeaways

1. **Never write "Per docs" without reading the docs:** If a plan claims something is documented, verify it before implementing. "Per Apple docs" in a code comment is a factual assertion — treat it with the same rigor as a test assertion.
2. **Verify facts from plans the same way you'd verify facts from memory:** A plan written by an AI is not a primary source. It can be wrong. The plan said "Per Apple docs" but had never checked.
3. **Low-confidence plans need higher verification, not lower:** The plan stated ~50% confidence. That should have triggered MORE verification, not less.
4. **The Research-First Protocol exists for a reason:** CLAUDE.md says "NEVER propose solutions based on assumptions alone." This applies to implementing plans too — the plan was the assumption.

### Files Affected

- `@keiver/expo-tvos-search/ios/ExpoTvosSearchModule.swift` (incorrect implementation)
- `@keiver/expo-tvos-search/src/index.tsx` (incorrect JSDoc)

---

## tvOS FlatList Focus Escape Bug (January 2026)

### Problem

Focus cannot escape FlatList to reach tab bar when pressing UP. Within the grid, up/down/left/right navigation works. But vertical navigation to elements OUTSIDE the ScrollView (like tab bar) is blocked.

### Root Cause (CONFIRMED)

`RCTScrollViewComponentView.mm` lines 1177-1182 contains an overly restrictive containment check:

```objc
BOOL isMovingUp = (context.focusHeading == UIFocusHeadingUp && self.scrollView.contentOffset.y > 0);
BOOL isMovingDown = (context.focusHeading == UIFocusHeadingDown &&
    self.scrollView.contentOffset.y < self.scrollView.contentSize.height - MAX(self.scrollView.visibleSize.height, 1));

if (isMovingUp || isMovingDown) {
    return (context.nextFocusedItem && [UIFocusSystem environment:self containsEnvironment:context.nextFocusedItem]);
}
```

When scrolled (`contentOffset.y > 0`), pressing UP triggers the containment check. If `nextFocusedItem` (tab bar) is OUTSIDE the ScrollView, `containsEnvironment` returns NO, blocking the focus update entirely.

### What We Ruled Out

- ❌ **Video overlay / modal transitions** — Bug exists without playing video
- ❌ **expo-router / react-navigation** — Not involved
- ❌ **TVFocusGuideView** — Our addition made it worse, but bug exists without it
- ❌ **expo-tvos-search native module** — Not the cause
- ❌ **requestTVFocus() with staggered delays** — Controls position, not traversal
- ❌ **hasTVPreferredFocus** — Only affects initial mount
- ❌ **setNeedsFocusUpdate()** — Controls where focus goes, not if it CAN go

### Key Distinction

All attempted fixes work on **focus POSITION** (where focus is). The bug is in **focus TRAVERSAL** (where focus can go). These are separate systems in UIKit.

### What We Attempted (All Failed)

1. Multiple `requestTVFocus()` calls with staggered delays (150ms, 300ms, 500ms)
2. `TVFocusGuideView` wrapper with `autoFocus` and `destinations` props
3. `hasTVPreferredFocus={true}` on grid items
4. `focusRestoreKey` state to trigger re-evaluation
5. Passing refs via `forwardRef` to first grid item

### The Real Fix (Not Yet Implemented)

Patch `react-native-tvos` to change the containment check to defer to parent hierarchy when target exists outside:

```objc
if (isMovingUp || isMovingDown) {
    if (!context.nextFocusedItem) {
        return NO;  // No target, block (scroll instead)
    }
    if ([UIFocusSystem environment:self containsEnvironment:context.nextFocusedItem]) {
        return YES;  // Target inside scroll view, allow
    }
    // Target exists but OUTSIDE - defer to parent hierarchy
    return [super shouldUpdateFocusInContext:context];  // ← THE FIX
}
```

### Key Takeaways

1. **Focus position and focus traversal are different systems** — restoring position doesn't fix traversal
2. **Verify root cause before implementing fixes** — We wasted time on JS-level fixes when the bug is in native code
3. **Test without the suspected cause** — Testing grid navigation WITHOUT playing video proved overlay wasn't the issue
4. **Read the actual native code** — The answer was in `RCTScrollViewComponentView.mm` the whole time
5. **TVFocusGuideView can make things worse** — It interfered with normal focus behavior
6. **Core RN bugs require core RN patches** — JS-level workarounds cannot fix native containment checks

### Files Relevant

- `node_modules/react-native/React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm:1177-1182` (the bug)
- `app/(tabs)/index.tsx` (where we attempted JS fixes)

### Status

Codebase reset to clean state. Awaiting `patch-package` implementation to fix the native code.

---

## Template for Future Lessons

When adding new lessons, use this format:

```markdown
## [Issue Title] ([Month Year])

### Problem

[1-2 sentence description of user-facing issue]

### Root Cause

[Technical explanation of why it happened]

### Solution

[What fixed it]

### Key Takeaways

1. [Lesson 1]
2. [Lesson 2]

### Files Affected

- [file:line]

### Commit

- Hash: [commit hash]
- Message: "[commit message]"
```

---

## Watch Progress Never Persisted on tvOS (June 2026)

### Problem

Continue-watching never updated. Every 8s during playback the app logged "Failed to persist watch progress" with `NSFileWriteNoPermissionError`: "You don't have permission to save the file watch_progress.json in the folder Documents." Reads succeeded, writes always failed.

### Root Cause

`watchProgressService.ts` stored the file in `FileSystem.documentDirectory`. The build is tvOS (`SDKROOT = appletvos`), and tvOS denies apps writing to `Documents` — local persistent storage is restricted to `Library/Caches` (purgeable) or iCloud key-value store. In `expo-file-system@56`, the legacy module's `ensurePathPermission` (sandbox scoped-access check) passes, but the real `data.write(to:url, .atomic)` at `FileSystemLegacyModule.swift:112` throws the OS-level no-permission error.

### Solution

Switched `STORAGE_FILE` to `FileSystem.cacheDirectory`. Updated the test mock to expose `cacheDirectory`.

### Key Takeaways

1. On tvOS, never write to `documentDirectory` — use `cacheDirectory` (purgeable) or iCloud KV.
2. A passing expo scoped-permission check does not mean the OS will allow the write.

### Files Affected

- `services/watchProgressService.ts:8`
- `services/__tests__/watchProgressService.test.ts:8`

---

## SecureStore Keychain Writes Failed on tvOS — Missing Entitlement (June 2026)

### Problem

Connecting to the demo Jellyfin server (Settings → demo server row) failed with an alert: "Demo Connection Failed — Unable to connect to demo server: Calling the 'setValueWithKeyAsync' function has failed → Caused by: A required entitlement isn't present." Not actually demo-specific: every credential write to the Keychain would have failed the same way; the demo flow is just the first `SecureStore.setItemAsync` call the user hits.

### Root Cause

`connectToDemoServer()` writes credentials via `SecureStore.setItemAsync` (`services/jellyfinApi.ts:383-385`). On tvOS, `SecItemAdd` returns `errSecMissingEntitlement` (-34018) — "A required entitlement isn't present" — when the signed binary lacks the `keychain-access-groups` entitlement. The generated `ios/TomoTV/TomoTV.entitlements` was an empty `<dict/>`. The `expo-secure-store` config plugin does NOT add the keychain entitlement (it only sets `NSFaceIDUsageDescription` and Android backup rules — verified in `node_modules/expo-secure-store/plugin/build/withSecureStore.js`). Unlike iOS, tvOS does not grant a default keychain access group automatically.

### Solution

Added the entitlement via `app.json` `ios.entitlements` (prebuild-safe — editing `ios/` directly is wiped by `prebuild:tv`):

```json
"entitlements": {
  "keychain-access-groups": ["$(AppIdentifierPrefix)dev.keiver.tomotv"]
}
```

Then `npm run prebuild:tv` regenerates `TomoTV.entitlements` with the key. `$(AppIdentifierPrefix)` scopes the group to this app only (no cross-app sharing).

### Key Takeaways

1. On tvOS, any expo-secure-store Keychain write requires an explicit `keychain-access-groups` entitlement; iOS gets a default group, tvOS does not.
2. The expo-secure-store config plugin does not inject keychain entitlements — add them in `app.json` `ios.entitlements`.
3. "A required entitlement isn't present" == `errSecMissingEntitlement` (-34018), a Keychain entitlement problem, not a network/server problem despite the "connection failed" wrapper.

### Files Affected

- `app.json` (added `ios.entitlements.keychain-access-groups`)
- `ios/TomoTV/TomoTV.entitlements` (regenerated by prebuild)

---

## tvOS Menu/Back Button — Use a Real Nested Stack, Don't Fight the Tab Bar (June 2026)

### Problem

In the Library tab, the Apple TV Menu/back button would not go up one folder level. Folders were
"virtual" state in a single screen (`folderNavigationManager` + a `folderStack`), so when focus was
on the grid the native tab bar swallowed the Menu press (moving focus to the tab bar instead of
navigating), and a second press exited the app.

### Root Cause

The tabs are a native `UITabBarController` (expo-router `unstable-native-tabs`). On tvOS, a tab whose
content has **no navigation stack** lets the tab bar's focus engine claim the Menu button. There was
no real stack for Menu to pop, so it could only collapse focus to the tab bar / exit — the
platform-intended behavior given the (wrong) structure.

### Solution

Make folder drill-down **real expo-router routes**: a nested `Stack` inside the Library tab
(`app/(tabs)/(library)/_layout.tsx` + `index.tsx` + `[folderId].tsx`), data via
`hooks/useFolderContents.ts`. With a real stack and **zero menu handlers**, the Menu button pops the
stack natively and only reaches the tab bar at the libraries root (Apple-correct).

### Key Takeaways

1. On tvOS, back-navigation inside a tab must be a **real navigation Stack** — the Menu button pops
   it natively. NEVER attach a JS/native Menu handler (`enableTVMenuKey`, `useTVEventHandler('menu')`,
   custom recognizer); any handler breaks the platform behavior.
2. Research the platform's accepted pattern early; a tabbed app needing "Menu goes back" is the most
   standard tvOS need — don't invent workarounds.
3. Verify TV focus/remote behavior on-device (drive the sim, screenshot), never from assumptions.
4. Only ever install **signed** simulator builds; `CODE_SIGNING_ALLOWED=NO` strips entitlements and
   breaks Keychain/SecureStore.

### Files Affected

- Added: `app/(tabs)/(library)/{_layout,index,[folderId]}.tsx`, `components/library-grid.tsx`,
  `hooks/useFolderContents.ts`, `services/folderContentsCache.ts`
- Removed: `services/folderNavigationManager.ts`, `contexts/FolderNavigationContext.tsx`,
  `services/tvMenuInterceptor.ts`, `native/ios/TVMenuInterceptor/`, `plugins/withTVMenuInterceptor.js`

---

## tvOS — Up From a Folder Grid Pops the Nested Stack to Root (June 2026)

### Problem

After the nested-Stack refactor, pressing **Up** from the top row of a folder grid moved focus to
the native tab bar and the nested Stack popped back to the libraries root — losing the user's place.

### Root Cause

The known native scroll-view containment check (`RCTScrollViewComponentView.mm`) only traps Up when
the list is scrolled (`contentOffset.y > 0`). At the **top row** (`contentOffset.y === 0`) Up escapes
the FlatList to the tab bar. Focusing the already-selected Library tab while a child route is pushed
makes `UITabBarController` collapse that tab to its root — so the escape reads as a back-to-root pop.

### Solution

Wrap the folder content in `<TVFocusGuideView trapFocusUp>` — **folder variant only**, gated on
`IS_TV`. Up from the top row now stays on the screen; the user goes up with the Menu button (native
pop), and Down/Left/Right and in-grid Up are unaffected. The **libraries root is NOT wrapped**, so Up
there still reaches the tab bar to switch tabs. Verified on the sim: folder Up = no pop, Menu still
pops to root (focus restored to the grid), root Up still reaches the tab bar.

### Key Takeaways

1. The earlier "TVFocusGuideView / trapFocusUp always fights the platform" note was scoped to the
   **Menu button** fight. For the **Up arrow** escaping a scroll view, `trapFocusUp` is the correct,
   purpose-built tool — with no `destinations`/`autoFocus` it stays non-focusable and only blocks the
   upward escape.
2. Apply the trap **only where the escape is destructive** (inside a folder), never at the tab root —
   blanket trapping would break tab switching.
3. Confirm all three paths on-device after a focus change: the fixed path, the path that must still
   work (Menu pop), and the one you might regress (root Up to tab bar).

### Files Affected

- `components/library-grid.tsx` (TVFocusGuideView trap around the folder content)

> **SUPERSEDED (August 2026)** — the root cause above is wrong and the trap has been removed. See
> "tvOS — Position-Aware Up and Down in the Folder Grid" below.

---

## tvOS — Position-Aware Up and Down in the Folder Grid (August 2026)

### Problem

Two directional dead-ends in the same grid:

- **Up**: the `trapFocusUp` from the entry above meant Up did nothing at a folder's top row. Switching
  tabs required Menu-ing out of every folder level to the libraries root first.
- **Down**: with a partial last row (6 items over 4 columns), Down from row 1 column 4 did nothing —
  no card sits directly beneath it. Apple's grids snap to the nearest card in that direction.

### Root Cause

**Up.** The previous entry blamed `UITabBarController` for collapsing the tab to its root. It does not.
`RNSTabBarController.mm:399-409` returns `NO` from `shouldSelectViewController` on repeated selection
_specifically to block_ UIKit's own pop-to-root ("works only starting from iOS 26 and interferes with
our implementation"). The pop was react-native-screens' own **repeated-tab-selection special effect**:
`RNSScreenStack.mm:143-155` calls `popToRootViewControllerAnimated:` when the stack has more than one
controller, falling through to `scrollToTop` otherwise. No `TARGET_OS_TV` gate. On tvOS, moving focus
UP to the tab bar counts as selecting the focused tab, so Up out of a folder tripped it.

**Down.** UIKit only moves focus to a candidate intersecting the projection of the focused frame in
the press direction, so a card with empty space beneath it dead-ends. `UICollectionView` supplies this
for Apple's own grids; a `FlatList` gets nothing and must name the target itself.

### Solution

**Up** — the special effect has a public off switch. `specialEffects.repeatedTabSelection.popToRoot`
comes from expo-router's `NativeTabs.Trigger` prop `disablePopToTop` (and `disableScrollToTop` for the
fallback branch). Set both on the `(library)` trigger, gated on `Platform.isTV` so phone keeps the
standard iOS tap-the-selected-tab affordance. Constant per build, so it does not trip the
static-trigger remount hazard. The `TVFocusGuideView trapFocusUp` in `library-grid.tsx` is then
deleted; the ladder becomes top row → Filters bar (via `nextFocusUp`) → tab bar, and a scrolled grid
still keeps Up inside itself via the native scroll containment check.

**Down** — a second deterministic-handle rule beside the existing `nextFocusUp` one:

```
lastRowStart = Math.floor((total - 1) / numColumns) * numColumns
nextFocusDown = isInsideFolder && index >= total - numColumns && index < lastRowStart ? lastCardHandle : undefined
```

Only the final row can be partial, so the stranded cards are exactly those in the row above whose
column runs past its end — and for every one of them the nearest card downward is the final card, so
one handle serves them all. Collapses to an empty range for a full last row, a single row or a single
item. Both card components are `React.memo` with explicit comparators, so `nextFocusDown` had to be
added to `arePropsEqual` or the prop change would not re-render.

### Key Takeaways

1. When a library's behaviour looks like a platform constraint, **read the library's native source
   before working around it**. The pop was 12 lines of Objective-C behind a documented prop, and the
   workaround cost the tab bar its reachability from every folder for two months.
2. A superseded lesson is worse than no lesson: it makes the wrong cause authoritative. Mark it.
3. tvOS focus is geometric, not index-based. Any grid with a ragged final row has to state its own
   diagonal targets; `FlatList` will not do it, and neither will a focus guide reliably on Fabric.
4. `nextFocus*` targets are native node handles from `findNodeHandle`, so a memoized card must list
   them in its comparator to receive an updated one.

### Files Affected

- `app/(tabs)/_layout.tsx` (`disablePopToTop` / `disableScrollToTop` on the Library trigger)
- `components/library-grid.tsx` (trap removed, `lastCardHandle` + `nextFocusDown` rule)
- `components/video-grid-item.tsx`, `components/folder-grid-item.tsx` (`nextFocusDown` prop + comparator)
- `app/(tabs)/(library)/__tests__/library-grid.focus.test.tsx` (`nextFocusDown` derivation)

---

## Jellyfin — IncludeItemTypes Silently Drops Unlisted Media Kinds (July 2026)

### Problem

A user's Music Videos libraries showed their cover art at the root but rendered completely empty
when opened (issue #46). Movies, Shows, and Home Videos libraries in the same server worked fine,
and the same Music Videos libraries listed items correctly in Infuse.

### Root Cause

Jellyfin's `/Users/{id}/Items` endpoint treats `IncludeItemTypes` as a strict allowlist over its
37-kind `BaseItemKind` enum — any kind not named is silently dropped, no error. The app's three
hand-written type lists lacked `MusicVideo`. Crucially, the item kind is decided by the LIBRARY
type at scan time, not the file: the same .mp4 becomes `Movie` in a movies library, `MusicVideo`
in a musicvideos library, and generic `Video` in homevideos (verified in Jellyfin v10.10.5
`MovieResolver.cs`). The root list comes from `/Users/{id}/Views` with no type filter, so every
library advertises itself even when its children are all filtered out — hence "tile shows, folder
empty". The identical latent bug existed for `Photo` (photos/homevideos libraries), `AudioBook`,
and `Trailer`.

### Solution

Centralized the kind lists into single-source allowlist constants next to `isFolder()` in
`services/jellyfinApi.ts` (`FOLDER_ITEM_TYPES`, `PLAYABLE_ITEM_TYPES`, `STANDALONE_VIDEO_TYPES`,
`VIEWABLE_ITEM_TYPES`) and derived all three queries from them. Added `Photo` to folder browsing
with a new full-screen photo viewer (`app/photo-viewer.tsx`, expo-image + TV remote stepping),
keeping photos out of search, the flat list, and the play queue so AVPlayer is never handed an
image. `Book`, live TV kinds, and plugin channels are documented as deliberately unsupported.

### Key Takeaways

1. When a Jellyfin library shows its tile but no contents, suspect `IncludeItemTypes` first — the
   server filters silently and the root views endpoint is unfiltered, so the UI advertises
   libraries the queries can't populate.
2. File extension/codec reasoning is a red herring for listing bugs: item kind is a property of
   the library's CollectionType resolver, not the file. Identical files behave differently across
   library types.
3. Keep server enum allowlists in ONE place. Three hand-written copies of the same list drifted
   and each needed the same fix (found via `grep IncludeItemTypes`).
4. When fixing one missing enum member, diff the full upstream enum against the allowlist —
   `MusicVideo` was reported, but `Photo`/`AudioBook`/`Trailer` had the same bug waiting.

### Files Affected

- `services/jellyfinApi.ts` (allowlist constants, `isPhoto`, `getPhotoUrl`)
- `app/photo-viewer.tsx` (new), `app/_layout.tsx`, `app/(tabs)/(library)/[folderId].tsx`
- `services/__tests__/jellyfinApi.test.ts`

---

## Jellyfin — ChildCount Is a RANDOM Number for Library Roots (July 2026)

### Problem

The item-count badge on folder cards was wrong everywhere: the "Music2" library card showed 5
despite holding thousands of tracks, and regular folders showed their subfolder count instead of
the number of files inside.

### Root Cause

Two distinct server behaviors, both verified in jellyfin master source:

1. `DtoService.GetChildCount` (`Emby.Server.Implementations/Dto/DtoService.cs`) returns
   `Random.Shared.Next(1, 10)` for any `ICollectionFolder`/`UserView` — a literal random 1-9 —
   with the comment "too slow to calculate for top level folders... Just return something so that
   apps... won't think the folders are empty". `/Users/{id}/Views` uses all-fields `DtoOptions`,
   so this garbage arrives even without requesting `Fields`.
2. For normal folders `ChildCount` counts DIRECT children only. The recursive leaf count lives in
   the separate `RecursiveItemCount` field, populated only when requested via `Fields` AND only
   for folders with `SupportsUserDataFromChildren == true` — which again excludes
   CollectionFolder/UserView ("These are just far too slow"), so library roots can never get a
   real count from item fields at all.

### Solution

- Request `RecursiveItemCount` in `Fields` for `fetchFolderContents`/`fetchPlaylistContents`;
  badge renders `RecursiveItemCount ?? ChildCount`.
- `fetchUserViews` strips the random `ChildCount` from every view and fires one lightweight count
  query per view in parallel (`ParentId={id}&Recursive=true&IsFolder=false&Limit=1`, read
  `TotalRecordCount`) — the same query the server's own `GetRecursiveChildCount` runs. A failed
  count leaves the badge hidden instead of showing a wrong number.
- Badge style: fixed width → `minWidth` + `paddingHorizontal` so real counts (4-5 digits) render
  as a pill instead of overflowing the circle.

### Key Takeaways

1. Never trust `ChildCount` on CollectionFolder/UserView items — it is deliberately random. Any
   Jellyfin client showing per-library counts must compute them via a `Limit=1` recursive query
   reading `TotalRecordCount`.
2. `ChildCount` = direct children; `RecursiveItemCount` = recursive non-folder leaves, and it must
   be explicitly requested in `Fields`. Series cards therefore show episode counts with
   `RecursiveItemCount`, season counts with `ChildCount`.
3. When a displayed value comes straight off the wire, verify the SERVER's semantics in its source
   before touching client logic — the first hypothesis (direct-vs-recursive) was incomplete; the
   random-value discovery only surfaced by reading `DtoService.cs`.

### Files Affected

- `services/jellyfinApi.ts` (`fetchViewItemCount`, `fetchUserViews` enrichment, `Fields` strings)
- `components/folder-grid-item.tsx` (badge value, memo equality, pill sizing)
- `types/jellyfin.ts` (`RecursiveItemCount`)
- `services/__tests__/jellyfinApi.test.ts` ("item count accuracy" describe)

---

## tvOS — Screens Presented as Modals Never Receive TV Remote Events (July 2026)

### Problem

The photo viewer opened and showed images, but left/right/playPause remote presses did nothing.
An earlier attempt blamed the animation library; the real failure was that no TV events reached
the screen at all.

### Root Cause

ALL TVEventHandler events (left/right/up/down/playPause/swipes) are generated by
`RCTTVRemoteHandler`, whose press gesture recognizers are attached ONLY to the RN root view
(`RCTRootView.m:104`) and to core RN `<Modal>`'s own view controller (`RCTModalHostView.m:110`,
added there precisely because presented modals leave the root view hierarchy).
react-native-screens has NO such handler, so a native-stack screen with
`presentation: "fullScreenModal"` is presented outside the root view and receives zero remote
events. Menu still "works" on such screens only via native modal dismissal. Corollary: the
player's `useTVEventHandler("menu")` handler is dead code for the same reason.

### Solution

Present remote-interactive screens as regular stack pushes (no `presentation` option) — they
stay inside the RN root view hierarchy and events flow. For select/Enter: there is no select
recognizer in `RCTTVRemoteHandler`; select is delivered per-focused-view by
`RCTTVRemoteSelectHandler` as `onPress`, so put the action on the focused element's `onPress`.
Photo transitions: worklet-driven shared values (`useSharedValue` + `withTiming` +
`useAnimatedStyle`, `.set()`/`.get()` for the react-hooks/immutability lint) — reanimated
LAYOUT animations (entering/exiting) are separately unreliable in native-stack contexts.

### Key Takeaways

1. On tvOS, `useTVEventHandler` only works on screens living inside the RN root view. Never
   use `presentation: "fullScreenModal"` (or any modal presentation) for a screen that needs
   remote events.
2. "Menu exits the modal" is NOT evidence that TV events reach it — native dismissal handles
   menu independently.
3. Select never arrives as a TV event; handle it as `onPress` on the focused view.
4. Simulator keyboard: arrows = directional presses, Return = select, Esc = menu; SPACE is not
   forwarded as any remote event on current Simulators — test play/pause via select fallback or
   a real remote.
5. Verify remote-input features by driving the simulator (osascript key codes + simctl
   screenshots), never by assuming events arrive.

### Files Affected

- `app/_layout.tsx` (photo-viewer presented as push, not modal)
- `app/photo-viewer.tsx` (worklet transitions, select+playPause slideshow, countdown bar)

---

## Expo — Dark Splash Variant Forces UIUserInterfaceStyle to "Automatic" (July 2026)

### Problem

App declared "Dark Interface" on the App Store and set `userInterfaceStyle: "dark"` in
app.json, but every prebuild emitted `UIUserInterfaceStyle = Automatic` in Info.plist —
even with an explicit `ios.infoPlist.UIUserInterfaceStyle: "Dark"` override.

### Root Cause

`expo-splash-screen`'s config plugin (`withIosSplashInfoPlist.js`) unconditionally writes
`infoPlist.UIUserInterfaceStyle = 'Automatic'` whenever ANY `dark` splash variant is
configured (`dark.image` / `dark.backgroundColor` / tablet variants). It runs after the
property-guard plugin, so it stomps both the root `userInterfaceStyle` mapping and the
explicit `ios.infoPlist` override. The plugin even logs a warning admitting the conflict:
"The existing `userInterfaceStyle` property is preventing splash screen from working
properly."

### Solution

Remove the `dark` block from the expo-splash-screen plugin config and set the base splash
`backgroundColor` to the dark color (`#1C1C1E`). With the app forced to Dark, the system
would always have picked the dark splash variant anyway, so nothing visible changes. Kept
the explicit `ios.infoPlist.UIUserInterfaceStyle: "Dark"` for determinism.

### Key Takeaways

1. A dark-only Expo app must NOT configure a dark splash variant — it silently re-enables
   Automatic interface style.
2. `ios.infoPlist` keys are guarded against the mapped abstract properties, but NOT against
   plugins that mutate the plist directly. Verify the emitted Info.plist, not the config.
3. Prebuild warnings are evidence: the splash plugin announced exactly what it was doing.

### Files Affected

- `app.json` (splash plugin config: single dark background; `ios.infoPlist.UIUserInterfaceStyle: "Dark"`)

---

## Jellyfin 10.11 Recursive View-Root Query Filters Are Unreliable (July 2026)

### Problem

Library tiles showed count badges of 0 for Music, Music Videos, Photos and Shows libraries that had content and browsed fine. After removing the type filter, a folder→folder→video library counted 3 instead of 1.

### Root Cause

Jellyfin 10.11 routes `ParentId=<library>&Recursive=true` queries through per-collection-type view builders that mishandle filters, and behavior differs per library collection type:

- `IncludeItemTypes` and `Filters=IsNotFolder` return `TotalRecordCount: 0` for music/musicvideos/photos/tvshows libraries (movies-like paths still work)
- `IsFolder=false` is silently ignored, so folders themselves get counted
- `MediaTypes` is the only filter applied correctly everywhere

The buggy `IncludeItemTypes` had been added in `1d028d7` as theoretical hardening ("mirror the browse allowlist"), bundled into an unrelated UI commit, and locked in by a mocked-server unit test that could not catch real server behavior.

### Solution

`fetchViewItemCount` filters with `MediaTypes=Video,Audio,Photo` only. Folders have no MediaType so they are excluded, and unsupported leaf kinds (e.g. Book) are not counted, which preserves the original allowlist intent.

### Key Takeaways

1. Mocked-server tests lock in assumptions about server behavior; they cannot validate query semantics. Verify new Jellyfin query shapes against a real server before asserting them in tests.
2. When a regression appears mid-branch, bisect the branch first — before theorizing about the server.
3. Jellyfin view-root recursive queries are special-cased per collection type; never assume a filter that works on one library type works on another. Test against one library of each type.

### Files Affected

- `services/jellyfinApi.ts` (`fetchViewItemCount`: MediaTypes filter, no IncludeItemTypes/IsFolder)
- `services/__tests__/jellyfinApi.test.ts` (asserts the MediaTypes query shape)
- `components/folder-grid-item.tsx` (0 never renders as a badge: `||` fallback + truthy guard)

---

## Jellyfin Silently Drops Image-Based Subtitles From HLS Manifests (July 2026)

### Problem

Issue #31: subtitles showed nothing for a well-formed MKV that worked on jellyfin-web. Both "Auto" and "CC" native player options were empty. All test media (Sintel, test5.mkv) worked fine.

### Root Cause

The reporter's file contained only PGS subtitles (image-based, Blu-ray). The app delivers subtitles exclusively via `SubtitleMethod=Hls` (WebVTT renditions in the HLS manifest). Jellyfin cannot convert image-based formats (PGS/DVDSUB/DVBSUB/XSUB) to WebVTT, so it omits those tracks from the manifest without any error. AVPlayer has no image-subtitle renderer, so client-side rendering is impossible (jellyfin-web uses a WASM `libpgs` renderer; Swiftfin has no equivalent and always burns in).

### Solution

Server-side burn-in, matching Swiftfin: when a file's subtitle streams are all image-based, request `&SubtitleStreamIndex=<MediaStream.Index>&SubtitleMethod=Encode` on the `master.m3u8` URL. The server renders the subtitle pixels into the video frames during transcode; the client just plays plain video. Track priority `IsDefault` → `IsForced` → first, gated by a settings toggle (default on). Mixed files (text + image subs) keep the Hls path so text tracks stay natively selectable, since `SubtitleMethod` is single-valued.

### Key Takeaways

1. Jellyfin drops undeliverable subtitle tracks from HLS manifests silently — an empty CC menu is not proof the file has no subtitles. Check `MediaStream.Codec` for image-based formats (`pgssub`, `dvdsub`, `vobsub`, `dvbsub`, `xsub`, `sup`).
2. `SubtitleMethod` is single-valued per transcode session: burn-in (`Encode`) and manifest text tracks (`Hls`) are mutually exclusive.
3. `SubtitleStreamIndex` is the raw stream index within the file (`MediaStream.Index`), not a subtitle-only ordinal.
4. Switching a burned-in track requires restarting the transcode with new params (Swiftfin does the same); it cannot be done through AVPlayer media selection.
5. Test media must cover image-based subtitles; text-based test files (SRT external or embedded) cannot catch this class of bug. ffmpeg can encode `dvdsub` (image-based) but not `pgssub`: `ffmpeg -i in.mkv -i subs.srt -map 0:v -map 0:a -map 1:s -c:v copy -c:a copy -c:s dvdsub out.mkv`.

### Files Affected

- `services/jellyfinApi.ts` (`isImageBasedSubtitleCodec`, `getBurnInSubtitleStream`, `getBurnInSubtitlesSetting`, burn-in params in `getTranscodingStreamUrl`)
- `hooks/useVideoPlayback.ts` (burn-in detection forces transcode; `burnInSubtitleIndexRef` threads the index into stream URLs)
- `app/(tabs)/settings.tsx` (SUBTITLES section: "Burn In Image Subtitles" toggle)

---

## Jellyfin Sessions Reports Are Gated: Short Items Never Get Resume Positions (July 2026)

### Problem

After migrating watch progress from a local file to server-side playback reporting (`POST /Sessions/Playing[/Progress|/Stopped]`), resume stopped working entirely for music and short videos. The reports were sent correctly (verified in logs); the server accepted them and silently discarded the positions.

### Root Cause

Every Sessions report routes through `UserDataManager.UpdatePlayState` on the server (verified verbatim in the `release-10.11.z` source, not docs), which applies three gates before persisting:

1. Position < `MinResumePct` (default 5%) → position zeroed.
2. Position > `MaxResumePct` (default 90%) or within 1s of end → position zeroed, item marked **Played**.
3. **Item runtime < `MinResumeDurationSeconds` (default 300s) → position zeroed, item marked Played.** A half-listened 4-minute song ends up Played with no resume point — this also pollutes IsPlayed/IsUnplayed filters.

The gates are server config a non-admin client cannot read (`/System/Configuration` is admin-only), so client-side threshold mirroring is not viable.

### Solution

`POST /Users/{userId}/Items/{itemId}/UserData` (`UpdateUserItemDataDto`) writes `PlaybackPositionTicks`/`Played` **verbatim with no gates** (confirmed in `SaveUserData`'s DTO overload). The resume list filter `IsResumable` is literally `PlaybackPositionTicks > 0`, so written positions surface in `/Items/Resume` and resume-on-play with no further changes. TomoTV follows each position-bearing Sessions report with a UserData write applying its own policy (≥ 2s, < 95% of duration), restoring the `Played` flag captured at session start (a blanket `Played: false` would clear legit watched flags on partial rewatches).

### Key Takeaways

1. Jellyfin's Sessions pipeline is not a raw persistence API — it applies server policy. For client-owned resume semantics, write UserData directly.
2. Never hardcode mirrors of server config values the client cannot read; design so behavior is identical regardless of server settings.
3. When capturing pre-session state (e.g. `Played`) for later restore, capture it on the FIRST metadata fetch only — mid-session re-fetches can return state the gates already polluted during the same session.
4. The `/Users/{userId}/...` routes are `[Obsolete]` legacy aliases on 10.11 (modern: `/UserItems/...`); functional but a future migration candidate app-wide.
5. Verify server behavior in the release branch source (`release-10.11.z`), not master and not the API docs — the gates are documented nowhere.

### Files Affected

- `services/jellyfinApi.ts` (`updateUserItemData`; `fetchResumeItems` MediaTypes=Video,Audio)
- `hooks/usePlaybackReporter.ts` (`persistResumePosition` after each position-bearing report)
- `hooks/useVideoPlayback.ts` (`wasPlayedAtStartRef` captured once per video)

---

## tvOS — Up From a Folder Grid Card Loses Focus, Filters Button Unreachable (July 2026)

### Problem

Inside a Library folder on Apple TV, pressing **Up** from a grid card intermittently fails to reach the Filters button: focus is dropped, the Filters CTA becomes unfocusable, Down lands on a lower card, and it stays broken until a hard app restart. Worse on Movies (landscape, 4 cols) than Music (portrait, 6 cols). Not reproducible on demand.

### Root Cause (CONFIRMED)

Two layers, both largely OUTSIDE our JS:

1. **Native focus traversal.** react-native-tvos overrides UIKit's ScrollView focus gate. In the installed **0.85.0-0**, `node_modules/react-native/React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm:1391-1396` (`shouldUpdateFocusInContext:`): when the list is scrolled (`contentOffset.y > 0`) and Up is pressed, it returns `containsEnvironment:context.nextFocusedItem` — i.e. **blocks the focus move unless the target is inside this scroll view**. This is the same gate as the Jan 2026 "tvOS FlatList Focus Escape Bug". Our Filters button was the FlatList's `ListHeaderComponent` — inside the scroll view but scrolled off-top (and an off-screen view isn't focusable), so Up fails; `trapFocusUp` then has no valid target and swallows the press, leaving focus dead until the process restarts.

2. **Unfixed rn-tvos New-Architecture bugs** (Expo 56 = Fabric): `hasTVPreferredFocus` fails after first use on tvOS (upstream #849), fails under react-navigation native-stack (#670 — expo-router IS native-stack), and snaps focus inside ScrollViews (#839). `components/library-grid.tsx` used `hasTVPreferredFocus={index === 0}` unconditionally on every folder mount → all three. TVFocusGuideView `destinations`/`autoFocus` are also unreliable after first load / under new arch (#204, #815).

**Why `app/(tabs)/search.tsx` never breaks (the reliable template):** its up-target (search box) is a **sibling OUTSIDE the FlatList**, always mounted, reached only from the top row where `contentOffset.y === 0` (gate defers to super); it gates `hasTVPreferredFocus` on `shouldShowResults`, sets the handle synchronously in the ref callback, and uses NO `trapFocusUp`. It structurally avoids every failure mode.

**Why intermittent + Movies-worse:** first mount works (#849), later navigations corrupt the focus env; landscape overflows the viewport sooner → `contentOffset.y > 0` far more often.

### Solution

Not yet landed (root cause confirmed; fix carries a design tradeoff, so left to a deliberate decision). Direction: mirror search.tsx — render the folder header as a **sibling outside the FlatList** (always-mounted, reachable from the top row), gate `hasTVPreferredFocus` on `items.length > 0`, drop the `requestTVFocus` re-anchor. Note: this pins the Filters/breadcrumb bar (no longer scrolls away) — a visible change the user rejected once. The definitive belt-and-suspenders option is a `patch-package` patch to the native gate (per the Jan 2026 entry), requiring `npm run prebuild:tv` + rebuild.

### Key Takeaways

1. **tvOS focus bugs are usually native traversal bugs, not JS position bugs.** If Up/Down/Left/Right can't GO somewhere, look at `RCTScrollViewComponentView.mm:shouldUpdateFocusInContext:` and the VC hierarchy — not `hasTVPreferredFocus`/`requestTVFocus`.
2. A `nextFocusUp` target must be **always-mounted and on-screen**. A `ListHeaderComponent` scrolls off and becomes unreachable; put the target OUTSIDE the FlatList (sibling), like search.tsx.
3. On new-arch (Fabric) tvOS, **do not rely on `hasTVPreferredFocus` past initial mount** (fails after first use / with native-stack / in ScrollViews). Gate it, and prefer imperative `requestTVFocus` from `useFocusEffect`.
4. Intermittent focus bugs require an on-device **hammer test** (many nav cycles), never a single screenshot.
5. Check THIS file first for any tvOS focus work — the native gate was already documented in Jan 2026.

### Files Relevant

- `node_modules/react-native/React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm:1368-1399` (native gate)
- `components/library-grid.tsx` (Filters button as ListHeaderComponent; unconditional `hasTVPreferredFocus`; `trapFocusUp`)
- `components/library-header.tsx` (`destinations` guide)
- `app/(tabs)/search.tsx` (the reliable template: sibling header, gated focus, no trap)

### Status

Root cause CONFIRMED. Fix pending a design decision (pin the Filters bar via the search-mirror JS change, and/or `patch-package` the native gate). Codebase reset to commit `4f6b85b`.

---

## Connect — Bare-IP Candidate Builder Broke Reverse-Proxy Addresses, and Every Failure Read the Same (July 2026)

### Problem

A user could not connect to `10.48.1.51`. The app already auto-probes bare IPs, so a default-port Jellyfin should have worked, and the error gave nothing to act on: every distinct cause printed "Couldn't reach a Jellyfin server at that address."

### Root Cause (CONFIRMED)

Two separate defects in `services/jellyfinApi.ts`:

1. **Subpath produced malformed URLs.** `buildServerUrlCandidates` appended the port to the whole string, so `10.0.0.5/jellyfin` became `https://10.0.0.5/jellyfin:8920`. All four candidates were garbage, so reverse-proxy addresses could never connect. Confirmed by reading the function, not inferred from the report.
2. **Diagnostics were discarded.** `resolveServerConnection` caught `Promise.any`'s `AggregateError` and threw a fixed string, dropping per-candidate reasons. `checkServerInfo` had already flattened connection-refused, TLS failure, HTTP status, and timeout into two generic messages upstream of that.

Not the cause, though all were plausible and checked first: ATS was correct (`NSAllowsArbitraryLoads` + `NSAllowsLocalNetworking`, and `NSAllowsLocalNetworking` covers RFC 1918); `NSLocalNetworkUsageDescription` and `NSBonjourServices` were declared; `Promise.any` works on Hermes (RN uses Hermes's native Promise when `HermesInternal.hasPromise()`), and bare-IP probing had shipped since 1.4.0.

### Solution

- Split authority from path before appending ports, and order the 443/80 candidates first when a path is present (a subpath implies a proxy).
- `ProbeError` carries `url` + `reason` (`timeout` / `unreachable` / `not_jellyfin` / `http_status`) while keeping the existing `message` strings, so the failure list is specific without breaking callers or tests.
- Added `Scan Network`: an HTTP sweep of the local subnet, with the device's own IP and netmask from a `getifaddrs` Swift module (`native/ios/MultiAudioResourceLoader/NetworkInfo.swift`).
- Chose the sweep over Jellyfin's UDP 7359 broadcast: broadcast on tvOS needs `com.apple.developer.networking.multicast`, which requires Apple approval and would block shipping.

### The /23 That Broke the First Cut

The reporting user's Mac was `10.48.1.51 netmask 0xfffffe00`, a **/23**, not the /24 everyone assumes. That single fact invalidated two things written minutes earlier:

- The sweep clamped to /24, so a TV holding a `10.48.0.x` lease would have swept its own half and never probed `10.48.1.51` — the one address it was looking for. Now the real netmask is honoured up to `MAX_SWEEP_HOSTS` (510, a /23), with the /24 clamp only as an over-wide fallback.
- `subnetMismatchHint` compared /24s, so it would have told a user on the same /23 that their server was "on a different network". It now masks with the interface's real netmask.

Server side was verified clean and is worth ruling out first in any repeat: `lsof -nP -iTCP:8096 -sTCP:LISTEN` showed `*:8096` (all interfaces, not loopback-only), `socketfilterfw --listapps` showed jellyfin explicitly allowed, and `curl http://10.48.1.51:8096/System/Info/Public` returned 200 in 7ms.

### Key Takeaways

1. **A generic catch-all error message is itself the bug.** When every cause reads the same, the user cannot act and neither can you. Carry a structured reason on the error and keep the human message stable.
2. **Never assume /24.** Read the interface netmask and use it. Larger networks hand out /23 and wider, and on a /23 the client and server routinely sit in different /24s while being on one subnet. Assuming /24 breaks both discovery and any "different network" diagnostic.
3. **On the simulator, "this device" is the host Mac.** `getifaddrs` returns the Mac's interfaces, so any logic that treats the local address as special (skip self, exclude self, trust self) behaves differently there than on hardware. Never exclude self from a LAN scan.
4. When widening an IPv4 mask, OR the **high** bits. `mask | 0xffffff00` forces at least a /24; `mask | 0x000000ff` forces a /32.
5. `arp -an` resolving many neighbours argues **against** blanket AP client isolation, so do not reach for that explanation first. Rule out the server side (bind address, host firewall, a direct curl to the LAN IP) before blaming the network.
6. Apple's Local Network permission cannot be probed from JavaScript. A denial is indistinguishable from an empty subnet, so offer a retry rather than asserting nothing is there.
7. `NSAllowsLocalNetworking` already exempts RFC 1918 addresses from ATS, so cleartext to a LAN IP is not the suspect it looks like.
8. Android's main manifest has no `usesCleartextTraffic` (only the debug overlays set it), so a release Android build blocks the `http://` candidates outright. Not fixed here since tvOS/iOS is the shipping target.

### Files Relevant

- `services/jellyfinApi.ts` (`buildServerUrlCandidates`, `checkServerInfo`, `resolveServerConnection`, `ProbeError`)
- `services/networkDiscovery.ts` (sweep, `buildSweepHosts`, `subnetMismatchHint`)
- `native/ios/MultiAudioResourceLoader/NetworkInfo.swift` (+ `.m`, and `plugins/withMultiAudioResourceLoader.js` file list)
- `hooks/useNetworkScan.ts`, `components/settings/NotConnectedSection.tsx`, `components/settings/ServerRow.tsx`

### Status

Landed and unit-tested (31 suites, 618 tests pass). **Device verification still outstanding:** requires `npm run prebuild:tv && npm run ios`, since the Swift module is new and the sweep cannot run without it.

## Stage 3 Codec Sweep — Three Bugs the Device Never Showed (August 2026)

### Context

Wiring `VideoTranscoder` into the local remux engine (exotic codecs → H.264 via
VideoToolbox) and validating against a generated-plus-downloaded codec matrix in
`~/Movies/codec-testing-tomotv/` through the macOS harness, which drives the
real engine sources through real AVFoundation.

### Key Takeaways

1. **`nm` proves linkage, not registration.** The only truth about what a
   prebuilt FFmpeg can decode is `av_codec_iterate` / `avcodec_find_decoder`
   at runtime. A 30-line probe binary settles it permanently.
2. **fMP4 HLS audio is AAC/AC-3/E-AC-3/ALAC territory.** MP3 must be
   transcoded, never copied, into fMP4 segments.
3. **movenc zeroes each new muxer instance's timeline.** Any architecture that
   rebuilds the muxer mid-session (seek-restarts) must restore absolute tfdt
   itself — `finishSegment` now records each track's first written DTS per
   generation and byte-patches the tfdt boxes (clamped at 0 for AAC priming).
4. **Match codec identifiers by prefix, never substring.**
5. **A session that cannot seek must die, not limp** — failing fast hands the
   player to the server fallback in milliseconds instead of 404-timeout loops.
6. The harness sweep found all five; the Apple TV found none of them. Wide,
   cheap, local fixtures (generate with Homebrew ffmpeg, download the four
   codecs no encoder exists for) beat device testing for coverage.

### Files Relevant

- `native/ios/LocalRemuxer/Remuxer.swift` (`patchTfdtToAbsolute`, `noteBaseDts`,
  seek fail-fast, EOF transcoder flush)
- `native/ios/LocalRemuxer/AudioTranscoder.swift` (`needsTranscode` minus MP3)
- `native/ios/LocalRemuxer/VideoTranscoder.swift` (pixel-format contract,
  input-clock time base, forced boundary IDRs)
- `services/localRemux.ts` (registry-verified codec lists, prefix matching,
  resolution/bit-depth/interlace gates)

### Status

Harness: 9 of 10 matrix files ALL PASS (VP8, VP9, MPEG-2 PS+TS, Xvid, WMV8,
FLV1, H.263, VC-1); VP6 sample plays from start and falls back on seek by
design (defective AVI index). 682 unit tests pass. Device verification
outstanding.

## Top Shelf Extension — Two Silent xcode-lib Traps When Adding a Second Target (August 2026)

### Problem

The new Top Shelf extension target (plugins/withTopShelfExtension.js) generated a
project where (a) the app target had no dependency on the extension, so a stale
.appex could be embedded, (b) the extension failed to compile because it
inherited the app's React bridging header, and (c) the finished app failed to
INSTALL on a real Apple TV (MIInstallerErrorDomain 59, "unknown extension
point") because web tutorials gave a wrong NSExtensionPointIdentifier.

### Root Cause

- `xcode`'s `addTargetDependency` (pbxProject.js:860) silently no-ops when the
  project has no pre-existing `PBXTargetDependency` / `PBXContainerItemProxy`
  sections — Expo's generated single-target project has neither. `addTarget`
  calls it internally, "succeeds", and returns a target with no dependency wired.
- withMultiAudioResourceLoader sets `SWIFT_OBJC_BRIDGING_HEADER` on every
  XCBuildConfiguration, including the PROJECT-level configs. A guard that skips
  the extension's own configs (by INFOPLIST_FILE) is not enough: the extension
  still inherits the setting from the project level.

### Solution

- Seed empty `objects["PBXTargetDependency"]` / `objects["PBXContainerItemProxy"]`
  sections before calling `addTarget`.
- Explicitly set `SWIFT_OBJC_BRIDGING_HEADER = '""'` on the extension's own
  build configs to override project-level inheritance (plus keep the skip guard
  in withMultiAudioResourceLoader so the loop never re-stamps them).

### Key Takeaways

1. **xcode-lib mutations can silently no-op.** After any addTarget/addBuildPhase
   call, grep the generated pbxproj for the structures you expect.
2. **Build settings inherit project → target.** Guarding a global settings loop
   by target is half the fix; new targets must explicitly override inherited
   settings they can't use.
3. **`Type` is a reserved member name in Swift** — Jellyfin's `Type` field needs
   a CodingKeys mapping.
4. **Extension Info.plist versions must match the app** — use
   `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` fed from app.json by
   the plugin, never literals that drift.
5. **For NSExtension plumbing, Xcode's own templates are the only ground
   truth.** Tutorials and even well-sourced research said the Top Shelf point
   identifier was `com.apple.tv-top-shelf-provider` and that a
   `TVTopShelfContentStyle` key plus principal-class-first ordering were
   required. Apple's shipped template ("TV Top Shelf Extension.xctemplate",
   AppleTVOS platform templates) shows the real contract: identifier
   `com.apple.tv-top-shelf`, no style key (the returned TVTopShelfContent
   subclass decides the style), no ordering constraint. The wrong identifier
   passes every build and simulator check and only dies at device install
   time (installd validates against the OS extension-point cache).

### Files Relevant

- `plugins/withTopShelfExtension.js` (section seeding, config-scoped settings)
- `plugins/withMultiAudioResourceLoader.js` (INFOPLIST_FILE guard)
- `native/ios/TopShelf/ContentProvider.swift`, `TopShelf-Info.plist`,
  `TopShelf.entitlements`

### Status

TopShelf target compiles standalone and embeds at TomoTV.app/PlugIns/ in the
full tvOS simulator build. On-device shelf rendering and deep-link selection
still need manual verification (extension process requires a simulator restart
after reinstall — known tvOS lifecycle quirk).

## Branch Sweep — How Dead Code and Broken Fallbacks Survived 682 Green Tests (August 2026)

### Problem

A full branch review (after the Top Shelf extension-point failure) found two broken
fallbacks, a leak, and several pieces of dead code in committed, fully-tested work:
the localRemux→server retry the code comments promised never fired (reducer only
granted retry to direct mode), the Up Next auto-skip effect was unreachable, a
metadata fetch could hang forever, and buildMuxer leaked FFmpeg contexts on six
error paths.

### Root Cause

- Comments asserted behavior ("retries on the server exactly like direct play")
  that the reducer never implemented — the intent lived in prose, not code.
- A unit test kept the dead auto-skip effect looking alive by feeding the
  component a prop combination (visible && progress<=0) the parent can
  provably never produce.
- A second hand-rolled codec registry (isCodecSupported) drifted from the
  registry-verified one in localRemux.ts, reintroducing the substring-matching
  anti-pattern lesson #4 had already banned.

### Key Takeaways

1. **A comment that promises a fallback is a claim to verify, not documentation.**
   Trace the actual dispatch → reducer → effect chain before believing it.
2. **Unit tests that construct impossible parent states certify dead code.**
   When testing a child in isolation, check the parent can actually produce the
   props under test.
3. **One registry per fact.** The moment a codec/capability list exists twice,
   the copies diverge silently; export the verified one and delete the other.
4. **Every error path after a resource acquisition needs the cleanup path** —
   a committed-flag defer beats repeating inline frees (buildMuxer pattern).

### Files Relevant

- `hooks/useVideoPlayback.ts` (reducer retry modes, seek timer tracking)
- `services/jellyfinApi.ts` (isCodecSupported → REMUXABLE_CODECS, fetch timeout)
- `components/up-next-overlay.tsx` + `app/player.tsx` (removed dead effect)
- `native/ios/LocalRemuxer/Remuxer.swift` (buildMuxer deferred cleanup)

### Status

All fixes applied and verified: lint, tsc, 681 tests green, full tvOS simulator
build compiles the Swift changes with TopShelf.appex embedded.

## Quick Back-Out Wiped the Server Resume Point — Stopped(0) Is a Server Write (August 2026)

### Problem

Opening a Continue Watching item and backing out within ~8 seconds removed it
from Continue Watching entirely: the session's final /Sessions/Playing/Stopped
report carried PositionTicks 0, and Jellyfin applies the Stopped report's
position to the item's playstate — position 0 means "not in progress".

### Root Cause

Every event-driven report (pause, backgrounding, back-out Stopped, resetSession)
read `lastSampledPositionRef`, which only the 8-second polling loop ever wrote.
A session shorter than the first poll tick reported 0 everywhere even though
playback had resumed at 67s (the Playing start report even said 67 — only
markStarted received the position explicitly). The cleanup comment claimed a 0
was harmless because the TomoTV persist skips <2s — true for the UserData write,
but it never considered that the SERVER also applies the Stopped body itself.

### Solution

- markStarted seeds lastSampled/lastReported with the start position it already
  receives, so even an instant back-out reports the resume point.
- The reporter now takes `positionSecondsRef` (the player's live onProgress
  clock) and event-driven reports prefer it — accurate positions at any moment,
  not just 8-second boundaries.
- `currentTimeRef` is reset on videoId change (it feeds the reporter now; a
  queue advance must not stamp the new video with the old one's clock), and the
  seek timer is cleared there too (same gap as the other timers).

### Key Takeaways

1. **Every Sessions report position is a server-side write, not telemetry.**
   Stopped(0) deletes resume state; guard the value at the source, not just in
   the app's own persist path.
2. **A position source only one code path updates is a stale-read bug waiting
   for a short session.** Seed it at session start and prefer the live clock.
3. Regression tests render the REAL hook (react-test-renderer probe), not a
   logic mirror — hooks/**tests**/usePlaybackReporter.position.test.tsx fails
   on the pre-fix code by construction.

### Files Relevant

- `hooks/usePlaybackReporter.ts` (bestPosition, markStarted seed)
- `hooks/useVideoPlayback.ts` (positionSecondsRef wiring, videoId-change resets)
- `hooks/__tests__/usePlaybackReporter.position.test.tsx` (regression coverage)

## HDR10 Verification Found Two Shipping Bugs in the HEVC Copy Path (August 2026)

### Context

Closing the "HDR10 passthrough unverified" release gap: generated a genuine
HDR10 file (libx265, PQ/BT.2020, mastering-display + CLL SEI) and ran it
through the engine. HEVC through the COPY path had never actually been played
before — every prior engine test was H.264 or a transcoded exotic.

### Key Takeaways

1. **"The pipeline works" claims are per-codec.** H.264 passing says nothing
   about HEVC through the same code — sample-entry tags, priming behavior and
   validator strictness all differ.
2. **CoreMedia's HLS validator is stricter than its progressive parser.** A
   concatenated init+segments file playing directly proves the media is
   decodable, not that HLS will accept it.
3. **macOS CLI processes cannot validate master-wrapped HEVC HLS at all**:
   even ffmpeg's own reference output fails with -12927 the moment ANY master
   playlist wraps it, while the same media playlist plays directly. H.264
   variants are unaffected. Harness HEVC verdicts stop at the direct-media
   level; the device is the only judge for HEVC variant selection.
4. Differential debugging against a known-good reference (ffmpeg's HLS muxer
   from the same source) beats staring at specs: byte-diffing init/segments
   located every real divergence (hvcC identical, edts irrelevant, audio tfhd
   corrupt) and the swap matrix isolated media-vs-playlist-vs-server.
5. Fixes shipped: hvc1 sample entries, leading negative-DTS drop extended to
   copied audio, VIDEO-RANGE always emitted, CODECS emitted for HDR only
   (SDR provably never needed it; an unverifiable string is riskier than
   none).

### Files Relevant

- `native/ios/LocalRemuxer/Remuxer.swift` (codec_tag hvc1, priming drop,
  VIDEO-RANGE/CODECS in masterPlaylist)
- `services/localRemux.ts` (videoRange/codecs from Jellyfin VideoRangeType +
  Level), `types/jellyfin.ts`

### Status

HDR10 metadata passthrough proven byte-level (bt2020nc/smpte2084/bt2020 +
mastering-display and CLL survive into the fMP4 output). Full SDR harness
regression green (VP8, MPEG-2, Xvid, H.264 copy). Device check remaining:
play "HDR10 HEVC PQ.mkv" on the Apple TV, expect the display to switch to
HDR and no -12927/-12927-family errors.

---

## tvOS Audio Remote Seek — RNV Programmatic Seek Wedges Under Native Controls (August 2026)

### Problem

Audio files ignored remote seek on Apple TV. The naive JS fix
(`videoRef.seek()` on left/right) paused playback permanently on the first
press; a library patch for that made everything with saved progress start
paused instead.

### Root Cause

Two layers:

- **Delivery:** the audio focus holder keeps focus outside AVKit, so every
  remote press arrives in JS via `useTVEventHandler` (select as `onPress` on
  the holder) and nothing else will act on it. Simulator keyboard arrows are
  a false positive — they reach AVPlayerViewController via UIKeyCommand, a
  path the physical remote does not have.
- **react-native-video 6.19.2:** programmatic seek force-pauses the player
  (`RCTPlayerOperations.swift:147`); with `controls={true}` the
  `timeControlStatus` observer latches that internal pause as user intent
  (`_paused = true`, `RCTVideo.swift:1669`); the completion re-applies it
  (`RCTVideo.swift:906`) → permanent pause, and JS never knows. Only
  triggers with `controls={true}` AND seek-while-playing — a combination
  mainstream RNV apps never run (custom-controls apps have no latch,
  native-controls apps only seek while paused for resume).

### Solution

App-level reconciliation, no patch, no custom UI: `onSeek` in
`videoCallbacks` calls `videoRef.current?.resume()` unless `pausedRef` says
paused. `onVideoSeek` fires after the erroneous re-pause in the same native
completion (`RCTVideo.swift:906-910`), so the reassert always lands last —
race-free by the lib's own code order; seeks issued while paused stay
paused. Remote mapping (gated `isAudioOnly`): left/right PRESSES ±10s via
`seekBy` (no swipes — a stray flick must not jump 10s); `playPause` event
and holder select toggle `paused ? play() : pause()`. AVKit's persistent
audio bar mirrors the AVPlayer, so seeks and pause state display natively.
Video untouched.

### Key Takeaways

1. tvOS audio: all remote control is JS; AVKit's persistent bar is a free
   native display — no custom transport UI needed.
2. Any JS seek on a playing player with `controls={true}` needs the
   `onSeek` → conditional `resume()` reconciliation (or `controls={false}`).
   Do not patch react-native-video for this.
3. Fix at app altitude: prefer reconciliation via the lib's own events and
   ordering over library patches or architecture changes.
4. Verify remote events on hardware — simulator keyboard is a different
   delivery path (arrows = UIKeyCommand, SPACE not forwarded).

### Files Affected

- `hooks/useVideoPlayback.ts` (seekBy, pausedRef, onSeek reconciliation)
- `app/player.tsx` (press seek, playPause/select toggle, gated isAudioOnly)
- `hooks/__tests__/useVideoPlayback.seekBy.test.ts`

### Status

Device verify pending after Xcode rebuild (NO prebuild): audio with
progress resumes and plays; left/right ±10s keeps playing, bar tracks;
select and play/pause toggle; Menu pops; video with progress resumes.

---

## Continue Watching Row Loses the Just-Played Item — Read Races the Closing Writes (August 2026)

### Problem

Backing out of playback made the item vanish from the in-app Continue
Watching row, while the server verifiably kept it (DB + live /Items/Resume
both had it). Flaky: a warm cache masked it (first back-out fine, second
broke).

### Root Cause

The row's focus-time refetch races the reporter's session-closing writes. A
Resume query the server answers WHILE processing Sessions/Stopped
transiently omits the item (proven by instrumented device log: GET fired
16ms before Stopped landed; response listed 20 items without the track,
backfilled from rank 21+). Sequential replays of the same writes never
reproduce it — only a concurrent read does. requestCache's in-flight guard
correctly refused to cache the poisoned response; the damage was the row's
already-resolved promise rendering it with nothing scheduled to look again.

### Solution

`subscribeResumeChange` in jellyfinApi (mirrors the played/favorite pub/sub),
fired by `invalidateResumeAndItem` / `invalidatePlayedReads` after each
completed resume write. The row subscribes while focused and refetches on a
250ms trailing debounce, so the burst of back-out writes (Progress persist,
Stopped, closing persist) triggers exactly one refetch that is guaranteed to
run after the last write finished. Diagnosis was settled by two permanent
debug logs (row fetch contents; cache-vs-network) — the path had zero
observability before.

### Key Takeaways

1. A read triggered by navigation can race the writes triggered by the same
   navigation. "Refetch on focus" needs a write-completion signal, not just
   a focus signal, whenever the same user action also queues server writes.
2. Jellyfin answers /Items/Resume inconsistently DURING Stopped processing.
   Never trust a Resume snapshot taken concurrently with a session close.
3. Sequential API replays cannot disprove a concurrency bug — the
   instrumented device log (which fetch, when, what it received) did in one
   repro what hours of server-side replays could not.

### Files Affected

- `services/jellyfinApi.ts` (subscribeResumeChange, notify on resume writes)
- `components/continue-watching-row.tsx` (subscribe + debounced refetch,
  fetch logging)
- `services/__tests__/jellyfinApi.resumeChange.test.ts`

## Continue Watching Press Lost the Resume Position — Trust the Data You Displayed (August 2026)

### Root Cause

Pressing a CW card discarded the row's fetched resume state and refetched
the item's UserData (fetchVideoDetails). The refetch answered
played:true/position:0 while /Items/Resume had said unplayed/1521s seconds
earlier — both network-verified, no client write between. The player
trusted the refetch: started at 0, captured playedAtStart=true, and the
persist design rewrote 41s/played to the server, destroying the position.
Branch diff proved no commit touched the resume path — long-standing flaw.
Same night: the binge-queue gate on `Type === "Episode"` never fired,
because homevideos libraries label episodes `Type: "Video"`.

### Solution

The row passes `startTicks`/`played` route params from its own data;
useVideoPlayback prefers them over the refetch (which stays as fallback for
folder browse, Top Shelf, queue advances). Queue building is gateless:
`SeriesId ?? ParentId` for every item. Follow-up guard: the reporter's 8s
poll sampled AVPlayer's clock (~0) while the resume seek was still
buffering and overwrote the seeded 2200s sample — `pendingSeekTargetRef`
now mutes poll sampling and pins bestPosition() to the seed until onSeek
fires (self-clears once the clock reaches the target).

### Key Takeaways

1. Hand displayed server state to the next screen; a refetch of the same
   data is a second chance for the server to contradict what the user saw.
2. Restore-on-persist flags (playedAtStart) amplify one poisoned read into
   repeated writes — seed them from the most trusted source available.
3. Never gate on Jellyfin `Type` for "episodes" — gate on structural fields
   (`SeriesId`, `ParentId`).
4. Never sample a player clock while a seek is in flight; it still reads
   the pre-seek position.

### Files Affected

- `components/continue-watching-row.tsx`, `app/player.tsx`,
  `hooks/useVideoPlayback.ts`, `hooks/usePlaybackReporter.ts`,
  `types/jellyfin.ts`

## Seek-Restart Relabelled the Media Timeline and Pushed Subtitles Early (August 2026)

### Problem

An MKV episode with embedded subtitles played them seconds AHEAD of the spoken
line in TomoTV; the same file was fine in Jellyfin Web. A cold start from 0:00
was clean, so the defect only appeared after a resume or a seek. The lead was
not constant: it varied with where you resumed.

### Root Cause

`native/ios/LocalRemuxer/Remuxer.swift` re-derived the timeline anchor on every
generation as `timelineAnchorUs = keyframeUs - currentSegment * 6s`, then
subtracted it from every packet's PTS/DTS. `restart(at:)` seeks with
`AVSEEK_FLAG_BACKWARD` bounded by `max_ts = segment * 6s`, so the landing
keyframe K is always at or BEFORE the boundary. The effect was to relabel that
keyframe as if it sat exactly on the boundary, shifting the whole media
timeline later by `(N*6 - K)`, up to a full GOP (10.43s on this x264 keyint-250
file; 5.418s at the user's actual resume point).

Audio and video shifted together and stayed in sync with each other, so
lip-sync looked fine. The HLS subtitle rendition is a single full-length
segment pointing straight at Jellyfin's WebVTT, whose cue times are absolute
source times and are never rebased. So subtitles ran early by exactly the
keyframe-to-boundary gap. `patchTfdtToAbsolute` did not compensate: it adds
`baseDts`, which `noteBaseDts` records AFTER the anchor subtraction, so it
cemented the shift. Generation 0 was unaffected (`currentSegment == 0`,
keyframe at 0, anchor 0), which is why a fresh start looked correct.

Same defect also meant reported position never matched on-screen content, so
seeks landed early and every Jellyfin progress report was off by the gap.

### Solution

One session-wide anchor, fixed by generation 0's first keyframe and reused
unchanged by every restart, so presentation time always equals source media
time. The generation now opens at `floor(keyframeSeconds / 6)` instead of
forcing the keyframe onto the requested boundary; the requested segment is
still fully covered because the seek runs BACKWARD. Its opening segment is
short at the head and is flushed but never published (a later request for that
index restarts at its own boundary and necessarily lands on an earlier
keyframe). `producingSegment` is floored at the requested segment so the waiter
does not re-assert its seek and loop onto the same keyframe forever.
`AudioTranscoder` now seeds its sample clock from the first packet it is handed
instead of a nominal `startSeconds`, which is what keeps transcoded audio
(AC3/DTS/TrueHD/FLAC/Opus) aligned under the new anchoring.

### Key Takeaways

1. **Never bend media timestamps to make a playlist's nominal grid true.** A
   uniform-segment playlist over sparse keyframes tempts you to relabel the
   keyframe; anything on a separate absolute timeline (WebVTT, chapters,
   progress reports) then desyncs. Move the segment index, not the clock.
2. **A/V staying in sync with each other proves nothing about correctness.**
   Both were shifted by the same anchor, so lip-sync was perfect while the
   whole stream sat several seconds off its own timeline.
3. **Code comments describing a design as intentional are not verification.**
   The anchor and `patchTfdtToAbsolute` comments both read as deliberate and
   correct; the arithmetic said otherwise. An explore agent reading the same
   comments concluded the path was sound.
4. **Establish which code path actually ran before rooting a cause in it.**
   The server log showed BOTH a server transcode and transcode-free sessions
   for this episode. The decisive evidence was a session reporting playback
   with no ffmpeg process and no new transcode log.
5. **Make the diagnosis falsifiable with a number.** Keyframe positions from
   ffprobe predicted 5.4s lead at one resume point and 0.9s at another; a
   constant offset at both would have killed the theory.

### Files Affected

- `native/ios/LocalRemuxer/Remuxer.swift` (session anchor, generation open
  segment, unpublished partial segment, `producingSegment` floor)
- `native/ios/LocalRemuxer/AudioTranscoder.swift` (clock seeded from the first
  packet, `startSeconds` removed)

### Still Open

- If a file's FIRST video keyframe is not at 0, generation 0 anchors there and
  the whole session shifts by that amount, desyncing subtitles constantly.
  Pre-existing and unchanged; anchoring at 0 instead risks the negative,
  non-monotonic DTS on B-frame files that the original comment documents.

## The Resume List Cannot Carry a Binge — Anchor on DatePlayed (August 2026)

### Problem

Bingeing from the Continue Watching row worked while the player stayed open
(queue + auto-advance + Up Next), but backing out took the whole series off
the row. The next episode was unreachable from home; the user read it as
"the queue is lost on Back".

### Root Cause

The queue was never the issue: `handleBack` clears it and tvOS Menu pops
natively, but the row rebuilds it from `SeriesId ?? ParentId` on the next
press. The row was 100% `/Users/{id}/Items/Resume`, and Jellyfin only lists
an item there while it is PART WAY through — above MinResumePct /
MinResumeDurationSeconds, below MaxResumePct (default 90%). So finishing an
episode dropped it, the next episode was never eligible, and the container
vanished. Same outcome from the other end: auto-advance to N+1, watch 30s,
back out — N is played, N+1 is under the resume floor.

### Solution

Derive next-up from the most recently FINISHED item per container:
`/Items?Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending`
(`fetchRecentlyPlayed`), group by `SeriesId ?? ParentId`, drop containers the
resume list already represents, then pick the first unplayed sibling after
the anchor from `fetchRecursiveVideos` — the same call and ordering the binge
queue builds from, so the card is by construction what the queue would play
next. `services/nextUp.ts`, appended after the resume cards.

Rejected `/Shows/NextUp`: it only knows real Series, and homevideos episodes
arrive as `Type: "Video"` with only a ParentId. One mechanism had to cover
both (see the gateless-queue lesson above).

### Key Takeaways

1. The resume list answers "what am I mid-way through", never "what am I
   bingeing". Those are different questions, and only the second survives an
   item being marked played.
2. Anchor on the last PLAYED item, not the last opened one. Played state is
   the only signal that is still true after the item leaves the resume list,
   and it makes the low end correct for free (30s into the next episode is
   below the resume floor, so the finished one is still the anchor).
3. Prefer deriving from the server over persisting a local trail: no
   staleness, no per-user cleanup, and it stays right when another client
   watches an episode.
4. `IncludeItemTypes` zeroes out music/musicvideos/photos/tvshows view-roots
   on recursive queries — `MediaTypes` is the filter that works (already
   documented on `appendFlattenFilterParams`, re-confirmed here).
5. Two awaits in one refresh path need a sequence guard. Adding the next-up
   resolution widened the load window enough that an older focus load could
   land its list on top of a newer one.

### Files Affected

- `services/nextUp.ts` (new), `services/jellyfinApi.ts`
  (`fetchRecentlyPlayed`, `recentPlayed:` invalidation, `EnableUserData` +
  `ParentId` on `fetchRecursiveVideos`),
  `components/continue-watching-row.tsx`

### Still Open

- `native/ios/TopShelf/ContentProvider.swift` fetches `/Items/Resume`
  directly and has the identical gap, so the tvOS home shelf still drops a
  finished series while the in-app row keeps it. Needs the derivation ported
  to Swift (1 + N requests inside the extension).

## A Library Root Returns No User Data At All (August 2026)

### Problem

Favoriting photos in the Photos library, then turning the Favorite filter on,
showed "No items match the current filters". Playing anything from a library
root also built an empty binge queue, and the photo viewer swiped the whole
folder instead of the filtered set.

### Root Cause

One server behavior behind all three. Measured on the live 10.11.1 server:

| query (ParentId = photos view root)      | result                                  |
| ---------------------------------------- | --------------------------------------- |
| `Recursive&MediaTypes=Video,Audio,Photo` | 65 leaves, `IsFavorite` false on all 65 |
| the same plus `Filters=IsFavorite`       | 0 items                                 |
| no `ParentId`, otherwise identical       | 14 items, incl. the 6 favorited photos  |

A recursive query rooted at a library VIEW ROOT (CollectionFolder) goes
through Jellyfin's per-collection-type view builder, which returns items with
EMPTY user data and ignores ItemFilter. So `IsFavorite`/`IsPlayed`/
`IsUnplayed` can never match there, and any card rendered from that response
shows no heart and no checkmark. Same family as the `IncludeItemTypes`
zeroing already documented on `fetchViewItemCount` — which was separately
killing the play queue: `fetchRecursiveVideos` used `IncludeItemTypes` and
the device log shows `totalVideos:0` for a library root holding 60 leaves.

### Solution

- `fetchRecursiveVideos` asks by `MediaTypes=Video,Audio` (exactly covers
  PLAYABLE_ITEM_TYPES; folders have no MediaType, Photos are MediaType Photo).
- User-data filters at a view root are resolved in the client from two
  queries that DO work: membership (leaves under the root) intersected with
  the root-scoped id sets (`fetchFavoriteIds`, new `fetchPlayedIds`). The
  resolution stamps `IsFavorite`/`Played` back onto the items, so the grid,
  the checkmarks and the long-press sheet all read true.
- `fetchFilteredVideos` takes the same branch, which is what feeds the
  filtered play queue and (now) the photo viewer. The viewer receives
  `libraryId` and loads the filtered set instead of the folder cache, which
  is unfiltered by definition.

### Key Takeaways

1. "The server returned 200 with an empty list" is not "there is nothing".
   Ask the same question a second way before believing it.
2. A filtered response's UserData is only as trustworthy as the query that
   produced it. `useFolderContents` skips its favorites annotation on
   filtered views precisely because it assumed the server had answered.
3. When a server surface is unreliable in one shape, find the shape that
   works and compose it, rather than accept a degraded feature: membership
   from one query, user state from another.
4. The app log is a primary source. `totalVideos:0` next to
   `folderName:"Photos Tomo TV"` was the whole queue bug, sitting in a log
   pasted for an unrelated reason.

### Files Affected

- `services/jellyfinApi.ts` (`fetchRecursiveVideos` MediaTypes,
  `isLibraryViewRoot`, `fetchViewRootLeaves`, `fetchPlayedIds`,
  `resolveViewRootMatches`, branches in `fetchFolderContents` /
  `fetchFilteredVideos`), `app/photo-viewer.tsx`,
  `app/(tabs)/(library)/[folderId].tsx`

### Still Open

- An ARTIST filter at a view root still rides `IncludeItemTypes`
  (`appendFlattenFilterParams` needs it — MediaTypes silently drops
  ArtistIds), which is the param that zeroes out there. Unverified, untouched.
- Whether `Genres`/`Years` survive a view-root query is likewise unverified;
  they are still sent server-side.

## Sidecar Subtitles Ran 10s Late (August 2026)

### Problem

Any direct-playable H.264 MP4 with a sidecar `.srt` played its subtitles exactly
10 seconds late. MKV with embedded subtitles was fine.

### Root Cause

Two commits in PR #59. `b2d56ff` inserted the localRemux branch above the
transcode branch and gated it on one of that branch's four conditions:

```ts
// pre-existing
if (requiresTranscoding || hasExternalSubs || burnInStream !== null || hasTriedTranscoding)
// inserted above it
const canRemux = !audioOnly && requiresTranscoding && !hasTriedTranscoding && (await canRemuxLocally(...));
```

`needsTranscoding()` returns false for H.264-in-MP4, so those files never reached
`canRemuxLocally()` and fell to the server. `4d108bb`, same PR, flipped that lane
from `SegmentContainer=ts` to `mp4` — and Jellyfin's `SubtitleMethod=Hls` stamps
every WebVTT segment `X-TIMESTAMP-MAP=MPEGTS:900000`, i.e. 10.0s, which is right
for its MPEG-TS output (PTS starts at 900000) and wrong for fMP4 starting at 0.

### Solution

Gate widened to `(requiresTranscoding || hasTextSubs)`, keyed on text subtitles
so embedded text tracks in MP4 are covered too. Forced _text_ burn-in dropped: it
set `AllowVideoStreamCopy=false`, costing direct play and stream copy, on a
premise the remux engine disproves. Forced _image_ still burns in.

### Key Takeaways

1. A branch inserted above an existing condition must mirror every term of that
   condition or justify each omission in a comment.
2. `X-TIMESTAMP-MAP` only means anything against MPEG-TS. Check for it on any HLS
   subtitle rendition paired with fMP4 video. The plain
   `/Subtitles/{i}/Stream.vtt` carries absolute times and no map; Jellyfin's
   segmented `subtitles.m3u8` does not.

### Files Affected

- `hooks/useVideoPlayback.ts`, `services/jellyfinApi.ts`
- `hooks/__tests__/useVideoPlayback.modeSelection.test.ts` (new)

### Closed (2026-08-16)

- The note here said text subs on an engine-declined file still keep the 10s
  offset. Re-read: they do not. `streamUrls.ts` sets `SegmentContainer=ts`
  whenever WebVTT renditions are present, precisely so Jellyfin's
  `X-TIMESTAMP-MAP=MPEGTS:900000` lines up with the segments, and T44/T45 assert
  that alignment on every run. The note predated its own fix. The population it
  worried about also shrank to almost nothing: interlaced and 10-bit sources now
  play on the engine.

## Firewall Silently Blocked Metro From the Physical iPhone (August 2026)

### Problem

Fresh `npm run clearios`, Metro up on `*:8081`, correct `ip.txt` baked into the
Debug build, and the iPhone still died at launch with `No script URL provided /
unsanitizedScriptURLString = (null)`. Simulators unaffected.

### Root Cause

The macOS Application Firewall allowlists per binary. Metro was running under
nvm node v22.12.0; the allowlist only contained v22.8.0 and Homebrew 23.6.1.
The phone's `RCTBundleURLProvider` probe of `http://<mac-ip>:8081/status` was
dropped, so it returned nil. "Automatically allow downloaded signed software"
was ENABLED and node is signed -- macOS auto-allow flaked anyway, with no
prompt. Loopback bypasses the firewall, so `curl` from the Mac and every
simulator kept working, which disguised it as an app regression.

### Solution

```
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add ~/.nvm/versions/node/v22.12.0/bin/node
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp <same path>
```

Relaunch the app, no rebuild needed.

### Key Takeaways

1. `No script URL provided` on a physical device with Metro running and a fresh
   build means the /status probe failed: run the sudo add/unblock for the
   CURRENT node binary first, then check iOS Local Network permission
   (Settings > Privacy & Security > Local Network).
2. `socketfilterfw --listapps` is STALE on macOS 26: the approved v22.12.0
   binary never appeared in it even after the fix demonstrably worked. Do not
   use it to decide whether a binary is allowed; the add/unblock command itself
   still works.
3. Every `nvm install` re-arms this trap: new path = new binary = not
   approved. Do not trust the "allow signed software" setting to cover it.
4. Success from the Mac itself (curl, simulator) proves nothing about the
   firewall; only device traffic traverses it.
5. Guard: `scripts/check-firewall.sh` (prestart + end of clearios/clear/lib)
   warns once per node-binary change, tracked in
   `~/Library/Caches/tomotv/firewall-checked-node`.

### Files Affected

- `scripts/check-firewall.sh` (new), `package.json` (prestart hook + wired into
  clearios/clear/lib before `expo start`)

---

## Local Remux Audio Switch Silently Reverted to the Default Track (August 2026)

### Problem

Switching audio during on-device remux playback (multi-audio MKV) restarted the
player with a spinner and seek-back, but the original default track kept
playing. The switch could be retried forever with the same result.

### Root Cause

The audio-switch restart stores the chosen Jellyfin stream index in
`selectedAudioTrackIndexRef` and rebuilds the stream. The transcode branch
consumes it (`AudioStreamIndex=` on the URL), but the localRemux branch called
`startLocalRemux(details)` with no track info. `startLocalRemux` re-sorts audio
tracks by Jellyfin's `IsDefault`, and the Swift engine's selection channel is
purely ordering: position 0 is muxed with the video and marked `DEFAULT=YES` in
the HLS master playlist, so AVPlayer re-selected the old default every time.

### Solution

Two stages. First, `startLocalRemux(videoItem, preferredAudioStreamIndex?)`:
the comparator puts the preferred index first, then falls back to default-first
(stable sort, so no-preference behavior is unchanged). The hook passes the ref
into the call and mirrors the same reorder when building `audioTrackMappingRef`
— the mapping must match the rendition order handed to the native side or the
_next_ switch targets the wrong stream.

The restart worked but surfaced label churn: AVKit labels a muxed (URI-less)
rendition from the file's embedded metadata (`und` → "Unknown", `eng` →
"English") while URI renditions get the playlist NAME, so reordering which
track was muxed changed each track's label style per switch. Final
architecture: (1) multi-audio remux never muxes audio — video-only variant,
every track a URI rendition, all labels from NAME (Remuxer.swift; the no-audio
primary and audio-only rendition code paths already existed); (2) localRemux
joined the multi-audio protocol's SEAMLESS branch in onAudioTracks — AVPlayer
swaps renditions natively, no restart, no spinner. The restart+reorder remains
as the rebuild path (error/seek recovery), driven by a new
`audioStreamIndexForReportingRef` holding the playing track's JELLYFIN index —
which also fixed the server reports, which had been sending the player-side
sequential index as `AudioStreamIndex`.

### Key Takeaways

1. In the remux engine, track ordering IS the selection API: whatever JS sorts
   to position 0 becomes `DEFAULT=YES` and the muxed track. Any feature that
   "selects" a track must express it by reordering.
2. `audioTrackMappingRef` and the array passed to the native side must be
   sorted by the same comparator, always. They are one contract split across
   two files.
3. When a ref is consumed by several stream-rebuild branches (transcode,
   localRemux, direct), check every branch consumes it — a fix in one branch
   proves nothing about the others.

### Files Affected

- `services/localRemux.ts` (preferredAudioStreamIndex param + comparator)
- `hooks/useVideoPlayback.ts:551` (pass ref), `:615` (mapping reorder)
- `services/__tests__/localRemux.test.ts`,
  `hooks/__tests__/useVideoPlayback.audioSwitching.test.ts` (new coverage)

### Commit

- Hash: uncommitted (device verification pending)

---

## Symbols Are Not Registration — The `aac_at` Branch Never Ran (August 2026)

### Problem

`AudioTranscoder.swift` preferred `aac_at`, documented as "Apple's AudioToolbox
encoder, which runs on dedicated silicon", falling back to FFmpeg's software
`aac`. Separately, an audit of the audio path listed the build's available
encoders (ac3, eac3, h263, alac_at, aac_at and more) by running `nm` over the
vendored `Libavcodec` framework. Both were wrong, and the second caused the
first to go unnoticed for months.

### Root Cause

The vendored FFmpeg xcframeworks are **static archives**. `nm` lists every
object file in an archive whether or not the build enabled that codec and
whether or not the linker would ever pull it in. MPVKit's configure line, which
this app was on at the time, was `--disable-encoders` plus an allowlist: `aac`,
`alac`, `flac`, `pcm*`, `movtext`, `mpeg4`, `h264_videotoolbox`,
`hevc_videotoolbox`, `prores`, `prores_videotoolbox`. No `aac_at`, no `alac_at`,
no `ac3`, no `eac3`. Our own build (`scripts/ffmpeg/build.sh`) carries a shorter
list; `npm run probe:codecs` is the only thing that says what any build holds.

So `avcodec_find_encoder_by_name("aac_at")` has always returned NULL and the
`??` fallback has always taken software `aac`. Nothing was broken, which is why
nobody noticed: the comment described a code path that never executed once.

`services/localRemux.ts:29-38` already warned about exactly this trap for
_decoders_ ("verified REGISTERED ... via `av_codec_iterate` — not by symbol: the
archive contains object files for codecs that were never enabled"). The warning
was read and quoted during the audit, then the same mistake was made anyway.

### Solution

`npm run probe:codecs` (`scripts/probe-codecs.{c,mjs}`) compiles a small C
program against the **macOS slice** of the same xcframeworks the app links and
prints what `av_codec_iterate` actually registers, plus each encoder's
`sample_fmts` and `ch_layouts`, plus whether the mp4 muxer will write a header
for a given codec in the engine's `empty_moov+default_base_moof+frag_custom`
configuration.

No prebuild, no simulator, no device: the tvOS and macOS configure lines differ
only in `--arch`, asm/neon and `--prefix`, so the codec set is identical.

### Takeaways

- `nm` answers "what is in the archive", never "what is registered". For any
  claim about codec availability, run the probe.
- A comment describing a fallback is not evidence the preferred branch works.
  `aac_at` would also have **failed to open** for 5.1 sources even if present:
  its layout list has `5POINT1` (side) while `av_channel_layout_default(6)`
  returns `5POINT1_BACK`, and `encode_preinit_audio` hard-rejects a layout that
  is not on the list.
- Re-run `npm run probe:codecs` after any MPVKit/FFmpeg bump. An upstream build
  change to the allowlist is silent otherwise.

### Files

- `scripts/probe-codecs.c`, `scripts/probe-codecs.mjs` (new)
- `native/ios/LocalRemuxer/AudioTranscoder.swift` (comment corrected, encoder
  selection rewritten)

### Commit

- Hash: 81b808b (engine change), probe added in a later commit on the same branch

---

## delay_moov Is Not a Dead End — Dolby Passthrough Was Shelved on a Half-Measurement (August 2026)

### Problem

AC-3 and E-AC-3 were decoded and re-encoded on their way through the on-device
engine, which destroys Dolby Atmos (it rides inside E-AC-3 as JOC side data) and
hands the receiver PCM instead of a bitstream it can decode itself. The reason
recorded in `Remuxer.swift` was that the fix was impossible:

> delay_moov is deliberately NOT set. It is what FFmpeg suggests for AC3 (whose
> dac3 box needs bitstream info the muxer only has after a packet), but it makes
> the muxer fold the first fragment into the moov as a bare mdat with no moof,
> which is not a valid HLS media segment.

That belief kept the feature shelved.

### Root Cause

The observation was real; the conclusion drawn from it was not. Measured against
the linked FFmpeg (n8.1.2) with the engine's exact
`empty_moov+default_base_moof+frag_custom` flags plus `delay_moov`:

- `avformat_write_header` emits **nothing**
- the **first** `av_write_frame(ctx, nil)` emits `ftyp` + `moov` and no media
- **every cut after that** is a clean `moof` + `mdat`

So a single flush does look like "the fragment got folded into the moov" — there
is a moov and no moof. The second flush is the missing half. Stopping at the
first observation produced a conclusion that was wrong in exactly the direction
that made the feature look impossible.

A priming flush before any packet does NOT work: the muxer still refuses with
"Cannot write moov atom before EAC3 packets parsed", because `dac3`/`dec3` are
built from bitstream fields `handle_eac3()` extracts from real packets. The
sequence has to be write packets, cut (init), cut again (the segment).

### Solution

`delay_moov` is added in `Remuxer.buildMuxer` **only** for renditions that copy
AC-3/E-AC-3 (`carriesDolbyCopy`), because it is a muxer-wide flag and every other
codec already writes a complete moov up front. `Rendition.awaitingDeferredInit`
marks the deferral, and `finishSegment` writes that first cut as the init segment
then cuts again so the segment gets its own fragment. Without the second cut the
buffered packets merge into the next segment and every boundary slips by one.

No hand-written `dac3`/`dec3` boxes were needed; the muxer writes them itself
once it has seen a packet. Our `dec3` is byte-identical to the one ffmpeg writes
muxing the same source.

### Takeaways

- A negative result from one configuration is not a property of the feature.
  Write down what was measured, not what it implies, or the implication outlives
  the measurement.
- Two probing artifacts masqueraded as defects during this work and both were
  fixed by `-analyzeduration 20M -probesize 20M`: E-AC-3 7.1 reporting 6 channels
  (dec3 declares 5.1, dependent substreams carry the rest) and the Atmos profile
  reading empty. Shallow probes under-report; deepen the probe before believing
  a loss.
- `expect.audioCopy` in the playback driver compares packet payloads as a
  MEMBERSHIP test, not positionally: an encoder can mark the first packet with
  SKIP_SAMPLES priming that the muxer consumes, so a faithful copy legitimately
  starts one packet later than the source file.

### Files

- `native/ios/LocalRemuxer/Remuxer.swift` (delay_moov, deferred init)
- `native/ios/LocalRemuxer/AudioTranscoder.swift` (AC-3/E-AC-3 in the copy set)
- `services/localRemux.ts` (CODECS emits `ec-3`/`ac-3`)
- `scripts/playback-regression.mjs` (audioProfile, audioCopy, deep probe)

### Commit

- Hash: 392956a

---

## AVPlayer Stopped Reaching the LAN on One Apple TV — Not Code, Not the Server (August 2026)

### Symptom

Every video the app handed straight to AVPlayer failed on the physical Apple TV
with `NSURLErrorDomain -1001` ("The request timed out") after 8 to 20 seconds.
Direct play and the server HLS retry both died. The simulator was clean, a fresh
install and a fresh Quick Connect token changed nothing, and the same MP4 served
`206 Partial Content` in 15 ms to `curl` from the server host.

The first instinct was a regression: the branch had just landed two commits and
run a clean dual prebuild. It was neither.

### Root Cause

AVFoundation's media loading on that Apple TV had wedged for non-loopback hosts.
It was cleared by rebooting the device, and it correlated with reinstalling the
app minutes earlier.

Nothing in the app was involved. `<Video>` receives identical props on every
lane; only `source.uri` differs.

### What Actually Localised It

Two measurements, in this order, and neither needed a second client:

1. **The server's own log.** A real `/Videos/{id}/master.m3u8` request always
   writes `MediaInfoHelper: User policy`, `DynamicHlsController`, and an ffmpeg
   spawn. Jellyfin wrote all three for the web client and **nothing** for the
   app. Absence in the server log is strong evidence only for endpoints that log
   unconditionally — a plain `GET /Videos/{id}/stream` writes nothing either way,
   so the transcode retry was the usable probe, not direct play.

2. **Socket-level proof from the server host.** Poll `netstat -an -p tcp` for the
   device's IP and log every distinct `local remote state` triple:

   ```bash
   netstat -an -p tcp | grep "<device-ip>" | awk '{print $4, $5, $6}'
   ```

   During the play attempt, three sockets to `:8096` opened in the same
   millisecond as the app's own PlaybackInfo and queue calls, and **AVPlayer
   opened none at all** — no refused connection, no slow one, no attempt.

That is what separates "the request failed" from "the request was never sent",
and it is what turned an hour of theorising into one fact.

### The Boundary Worth Remembering

On that device: everything the **app process** fetched worked, including the
engine's own FFmpeg pulling the source over HTTP. Everything **AVFoundation** had
to fetch from a LAN address never left the box. Loopback was unaffected, which is
why the on-device engine kept playing MKVs perfectly while MP4s that direct-play
all failed. The split is by URL host, never by file.

**A file is not corrupt because one lane fails.** Check what the working items
have in common first: here, every survivor went through the engine to
`127.0.0.1`.

### Takeaways

- Reach for the network layer before the code layer when the error is a network
  error and the code in the diff never touches networking. `git log -S` over the
  playback path took a minute and ruled the branch out.
- `xcrun simctl spawn <udid> log show --predicate 'eventMessage CONTAINS "8096"'`
  gives the same trace for simulators. Confirm **which device** produced a Metro
  log before trusting it: Metro aggregates every connected client, and two booted
  simulators plus a physical Apple TV were all attached here.
- `xcrun devicectl device sysdiagnose` fails on this Apple TV
  (`CoreDeviceCLISupport.DiagnoseError error 0`), with and without
  `--gather-full-logs`, and `log stream` has no `--device-name` on macOS 26.
  Console.app's device sidebar is the remaining route to a tvOS device log.
- macOS `/bin/bash` is 3.2 and has no associative arrays. `declare -A` fails
  silently and every `${seen[$key]}` lookup then errors, so a watcher script
  logs nothing and reads as a negative result. Two empty captures were this bug,
  not evidence.

### Files

- None. No code changed.

## In-App Image Subtitles — Three AVKit Behaviours No Comment Had Recorded (August 2026)

### Symptom

Three separate reports across one session, all in the subtitle path:

1. On a Blu-ray remux, picking a subtitle track drew a different track's bitmaps.
   Silently. No error, no log.
2. A file whose only subtitle track was flagged forced showed no subtitles and no
   subtitle entry in AVKit's picker at all.
3. Files with no subtitle streams whatsoever offered a "CC" option that drew
   nothing when selected.

### Root Cause 1 — Identity Was a Display Label

The app resolved the viewer's pick by matching the label AVFoundation reported
against a `Map` built from the same formula. `new Map(entries)` keeps the LAST
value for a duplicate key.

Jellyfin gives every untagged PGS track the identical `DisplayTitle`. Verified
against the server: T85 has 13 PGS tracks, none with a language or title, and 12
of them come back as `"Undefined - PGSSUB"`. All 12 collapsed onto stream 18.

Two more failures shared that root. `NAME` carried the same string, so AVKit
listed 12 identical rows, and react-native-video decides which track is selected
by comparing display names (`RCTVideoUtils.getTextTrackInfo`), so every duplicate
reported `selected: true` and `find()` took the first.

**Identity is now the ordinal** in AVFoundation's legible group, mapped through
one shared list both the engine config and the app build (`subtitleRenditions`).
No string is matched anywhere in the path. `resolveSubtitlePick` refuses rather
than resolving when the counts disagree or more than one track reports selected:
nothing drawn plus a loud log is recoverable, wrong subtitles drawn silently is
what this exists to stop.

### Root Cause 2 — FORCED=YES Loses the Track Outright

AVKit treats a forced rendition as something it applies for the viewer rather
than something the viewer picks, so it withholds it from the picker. **It then
does not apply it either.** Measured across three files differing in that
attribute alone:

| file                   | FORCED  | result                                                                          |
| ---------------------- | ------- | ------------------------------------------------------------------------------- |
| T06, one PGS track     | NO      | selection held, listed, drawn                                                   |
| T07, ten SUBRIP tracks | NO      | auto-selection cleared, still listed, manual picks hold                         |
| T05, one SUBRIP track  | **YES** | cleared 0.4s in, before its first cue at 2.253s, no picker entry, nothing drawn |

`FORCED=YES` is no longer emitted at all. `DEFAULT=YES` and `AUTOSELECT=YES`
carry the intent: the track still presents itself unasked, and stays something
the viewer can switch off. The cost is AVKit's "Auto" subtitle entry, which keys
off that attribute and could never have worked for a rendition AVKit will neither
offer nor render.

### Root Cause 3 — An Undeclared CLOSED-CAPTIONS Invents a Track

With no `CLOSED-CAPTIONS` attribute on `EXT-X-STREAM-INF`, the player cannot rule
out captions carried inside the video and offers a legible option with an empty
title and no language, which AVKit labels "CC". T88 has zero subtitle streams and
still reported one track (`count: 1, published: 0, title: ""`). ffprobe confirmed
no file in the library carries CEA-608/708.

RFC 8216 makes `CLOSED-CAPTIONS=NONE` the way to say there are none. Both
generators declare it now.

**Jellyfin never declares it either**, so single-audio transcodes, which hand
Jellyfin's manifest to AVPlayer untouched, still show the phantom. Closing that
means routing every transcode through the rewriting loader, which today only
multi-audio files touch.

### The Rule That Came Out Of It

Two wrong turns in this session came from believing a comment.

`Remuxer.swift` justified omitting `LANGUAGE` for `und` with "iOS always prefers
LANGUAGE for the label". The device log contradicts it: T06 ships
`LANGUAGE="eng"` and `onTextTracks` still reports NAME as the title. And the
FORCED comment said the behaviour was "harmless for a text track, because AVKit
draws the cues itself", which is exactly the case that turned out to lose the
track.

**Comments are claims, not facts.** Now a standing rule in `~/.claude/CLAUDE.md`:
read them, then follow the code path and verify against real output. A comment
asserting a measurement is not a measurement.

### Verifying a CODECS String Without Guessing

Apple requires `CODECS` on every variant (authoring spec 9.1) and a string
AVPlayer disagrees with rejects the whole variant, so it cannot be guessed. It
does not have to be: **Jellyfin computes the same string from the same bitstream
and stream-copies whenever it can**, so ours can be diffed against theirs offline
for every file in the library. All six combinations matched exactly:

```
High/31 avc1.64001F   High/41 avc1.640029   Main/30 avc1.4D401E
Main/31 avc1.4D401F   Main/51 avc1.4D4033   HEVC Main 10/120 hvc1.2.4.L120.B0
```

Read Jellyfin's `BANDWIDTH` to tell a copy from a transcode: it equals source
video plus audio on a copy (T11: 5666053 + 192000 = 5858053) and the requested
cap on a transcode (T05: 8000000 + 192000). A resolution match is NOT sufficient,
and mistaking one for a formula mismatch cost a detour.

`CODECS` stays absent where the engine re-encodes, since `VideoTranscoder` pins
no profile, and for profiles no fixture can prove. Omitting is the status quo for
those files, so nothing regresses.

### Takeaways

- A `Map` built from display strings is an identity scheme. Jellyfin's
  `DisplayTitle` repeats, and Matroska flags several subtitle tracks default at
  once, so anything derived from source metadata needs a uniqueness pass.
- When a guard refuses, make it say why at warn level, and make it silent when
  there is nothing of ours to resolve. The first version warned on every
  subtitle-less file, which is noise that trains people to ignore it.
- `AVPlayerViewController.unobscuredContentGuide` (tvOS 11+) is Apple's answer to
  "where will the chrome not cover me". A hand-tuned fraction of screen height
  was standing in for it.
- The patched tvOS transport-bar delegate had the wrong coordinator type for
  months. `AVPlayerViewControllerDelegate` methods are optional, so a wrong
  signature never errors, it just never fires. Check the SDK header, not memory.
- Do not ship a branch no fixture can exercise. `wvtt` in `CODECS` was written
  and reverted for exactly this: authoring spec 5.10 is a SHOULD, and the only
  HDR fixture carries no subtitles.

### Files

- `services/localRemux.ts` (`subtitleRenditions`, `resolveSubtitlePick`, `videoCodecTag`)
- `hooks/useVideoPlayback.ts` (ordinal resolution, gated on the engine lane)
- `native/ios/LocalRemuxer/Remuxer.swift` (FORCED, LANGUAGE, CLOSED-CAPTIONS, variant attributes)
- `native/ios/MultiAudioResourceLoader/HLSManifestGenerator.swift` and `HLSManifestParser.swift`
- `components/image-subtitle-overlay.tsx`, `patches/react-native-video+6.19.2.patch`
- `scripts/playback-regression.mjs`, `test/playback/manifest.json`

## Test Fixtures Ate the Owner's Own Jellyfin (August 2026)

### Symptom

"Some of my libraries have no edit menu and I can't remove them, and I don't have
access to my own libraries." The server had nine libraries where it should have
had four, two exact duplicate pairs among them, one library with no content type,
and ~500 iMovie render-file folders being served as home videos.

### Root Cause

`ensureLibrary()` in `scripts/make-test-media.mjs` decided a library already
existed with `existing.find((v) => v.Locations?.includes(dir))`. Path only. A
library covering that same directory under a different name was invisible to that
check, so the script created a second one over it. That produced `Movies` /
`Home Videos and Photos` (both `homevideos`, both `~/Movies`, both 509 items) and
`Music` / `Downloaded` (both `music`, both `~/Music/LocalPod`, both 62).

The worse half was nesting. A `homevideos` library rooted at `~/Movies` contained
the roots of three others (`~/Movies/TV`, `~/Movies/Music Videos`,
`~/Movies/development-videos`). Jellyfin attributes every file to the top-level
physical folder that owns it, so all 509 items hung off the `~/Movies` folder item
and the inner libraries were duplicated inside the outer one.

The third defect: `collectionType` is a query param on
`POST /Library/VirtualFolders`, and a library that does not receive it comes back
with a null type and no `*.collection` marker on disk. The API returns 204 either
way, so a create that silently produced a mixed library looked identical to a
correct one.

### What Actually Localised It

Not the code. `~/.claude/projects/<project>/*.jsonl` session transcripts, grepped
for `VirtualFolders`, which carry every request I ever made with its timestamp and
its result. That is how the `DELETE ... name=Movies -> HTTP 204` on 2026-08-12 and
the duplicate-creating POSTs were pinned to the minute. Then the server itself:
`GET /Library/VirtualFolders`, per-library recursive item counts, and
`~/Library/Application Support/jellyfin/data/jellyfin.db` read-only for
`BaseItems.TopParentId`, `Permissions` and `ActivityLogs`.

Also worth knowing: a library's real shape lives in
`~/Library/Application Support/jellyfin/root/default/<Name>/`. One `.mblink` per
path, an empty `<type>.collection` marker that IS the content type, and
`options.xml`. A library with no marker is the mixed one.

### Takeaways

- A destructive-adjacent script that reads its target from a dotenv is pointed at
  somebody's real server. Library registration is now `--with-library` opt-in, not
  `--skip-library` opt-out.
- Never create a library whose path contains, or is contained by, an existing
  library's path. `ensureLibrary()` refuses and records a failure.
- HTTP 204 is not verification. Read the resource back and assert the field you
  asked for, or the failure surfaces weeks later as "why is this library Other".
- Jellyfin skips any directory containing a `.ignore` file. Verified on 10.11.1
  against `Media.localized` and `TV Library.tvlibrary` inside `~/Movies/TV`: both
  disappeared as phantom Series after one `/Library/Refresh`. That is the tool for
  app packages sitting inside a media folder, and it beats moving the user's files.
- The Jellyfin admin Libraries page has no per-library gate on its card menu. In
  `jellyfin-web`'s `library.*.chunk.js`, `.btnCardMenu` is emitted whenever
  `showMenu !== false`, and only the synthetic "Add Media Library" tile sets that.
  A library with no `folder.jpg` renders as an icon-only card, which is the same
  shape as the Add tile.

### Files

- `scripts/make-test-media.mjs` (`ensureLibrary`, `isInside`, `VIDEO_DIR`, `--with-library`)
- `scripts/playback-regression.mjs` (`DEFAULT_LIBRARIES`, `fixtureLibraryIds`)
- `test/playback/README.md`, `memories/CLAUDE-testing.md`

## The Jellyfin OpenAPI Spec Documents a Parameter the Server Ignores (August 2026)

### Symptom

A series browsed as eight season folders: four real ones holding the episodes, and
four empty ones. The empty four were `LocationType: "Virtual"`, `Path: null`,
`IndexNumber` 1-4, 0 children. A Season whose `IndexNumber` is null does not
satisfy its episodes' `ParentIndexNumber`, so the server mints a numbered, empty
Season beside it and returns both.

### Root Cause of the Bad Fix

The first fix sent `ExcludeLocationTypes=Virtual`, taken from
`jellyfin-openapi-stable` (12.0.0), which documents it on `/Items` as "results
will be filtered based on the LocationType". **The server does not implement it.**
It is accepted, returns HTTP 200, and changes nothing.

### How To Prove A Filter Parameter Actually Filters

Do not test the parameter with the value you intend to ship, on data where it
should remove nothing. That passes whether or not the server implements it. Invert
it against data you already have:

```
ExcludeLocationTypes=FileSystem  -> 54 episodes   (should have been 0: IGNORED)
LocationTypes=FileSystem         -> 54 episodes
LocationTypes=Virtual            ->  0 episodes   (server discriminates: HONOURED)
```

Same result on `/Users/{userId}/Items` and `/Items?userId=`, Jellyfin 10.11.11.
The include-form works; the exclude-form is a no-op. The app now sends
`LocationTypes=FileSystem,Remote` (see `INCLUDED_LOCATION_TYPES`).

### Takeaways

- A published OpenAPI spec is a claim about the server, not the server. Verify a
  filter by making it filter something, in the direction that must return fewer
  rows.
- Prefer an allowlist to a denylist when both are offered: `LocationTypes` is
  implemented, `ExcludeLocationTypes` is not, and an allowlist also fails safe if
  a future kind appears.
- Filter server-side. Dropping rows after the fetch leaves `TotalRecordCount`
  counting rows the user cannot see, which breaks paging and "load more".
- `/Users/{userId}/Items` is no longer in the published spec (the documented form
  is `/Items?userId=`) but still answered on 10.11.11. MIGRATED in 666efa5: no
  call sites remain, and `native/ios/TopShelf/ContentProvider.swift` documents
  the move to `/UserItems/Resume` at its fetch. Kept here because the shape
  recurs — it is the same break as `api_key` to `ApiKey`.
- Two attempts to reproduce the null `IndexNumber` on 10.11.11 both parsed
  correctly. Unexplained, and deliberately not guessed at in the code comments:
  the fix keys on the row being fileless, not on how it got that way.

### Files

- `services/jellyfin/constants.ts` (`INCLUDED_LOCATION_TYPES`)
- `services/jellyfin/library.ts`, `items.ts`, `search.ts` (every user-facing list query)
- `services/__tests__/jellyfinApi.virtualItems.test.ts`

## onTextTracks Can Describe the Previous Item (August 2026)

### Symptom

The same direct-played `.mp4` reported `count:1` with an empty-titled track on
one play and `count:0` on the next. ffprobe: 2 streams, video and audio. No
subtitle or caption track exists in the file.

### Root Cause

`RCTVideo.handleTracksChange` binds both parameters to `_`, discarding the
`AVPlayerItem` the KVO callback hands it, then spawns an unstructured `Task`
that reads `self._player.currentItem` whenever it happens to run. Track-change
events fire repeatedly while an item loads, so several tasks race with no
ordering and one can enumerate a different item entirely.

### Fix

Guarded at app altitude, direct lane only: with no manifest, an item carrying no
subtitle stream cannot have a legible track, so that payload is dropped. **Not**
applied to the server lane, where Jellyfin's undeclared `CLOSED-CAPTIONS` makes
AVKit draw a phantom the viewer can actually see. Suppressing it there would
hide a real defect.

### Takeaway

Establish which lane can _prove_ a payload wrong before hardening, and leave the
lanes that cannot alone. Checking user-visible behaviour first is what sized the
fix: the picker showed no subtitle icon, which downgraded this from a defect to
log noise.

### Files

- `hooks/useVideoPlayback.ts` (`itemHasSubtitleStreamsRef`, guard in `onTextTracks`)

---

## A Nested Stack's First Screen Can Never Have a Native Back Button (August 2026)

### Symptom

The Quick Connect step (iOS) needed the system nav-bar back item, with `Cancel`
as its label. The routes already lived in a nested Stack (`app/connect/_layout.tsx`),
so the obvious change was flipping `headerShown` on. That gives Quick Connect a
nav bar with no back button in it, and its label would have been dead anyway.

### Root Cause

Two layers agree on the same answer for different reasons.

UIKit: every `ScreenStack` is its own `RNSNavigationController`. A back item is
drawn only for a view controller that has a predecessor in _that_ controller.
Quick Connect was the nested stack's root VC. react-native-screens never
fabricates one either — `useHeaderConfigProps` passes `hideBackButton:
headerBackVisible === false` and leaves the rest to UIKit.

react-navigation: it _does_ propagate a parent back through `HeaderBackContext`
(`canGoBack = previousDescriptor != null || parentHeaderBack != null`), so a
label would render on Android. The press is still dead: `onHeaderBackButtonClicked`
dispatches `StackActions.pop()` with `target` set to the _nested_ stack, and
`useOnAction.js` turns a null router result into "handled" whenever the action
names that navigator (`result = result === null && action.target === state.key ?
state : result`). It never bubbles to the root stack. `StackRouter`'s POP returns
null at index 0. So: no button on iOS, and a no-op button anywhere it draws.

### Fix

Deleted `app/connect/_layout.tsx`. Without an intermediate layout, expo-router
flattens the directory into the root navigator as `connect/quick-connect` and
`connect/login` — verified by calling `getRoutes` from
`expo-router/build/getRoutesCore.js` over a synthetic context module rather than
by assuming the naming. Both steps now sit above `(tabs)` in one nav controller,
so both get a real back item, plus the interactive swipe-back. Phone gets the
standard push (fade disagreed with a swipe-back); TV keeps the crossfade and no
header. `Cancel` and `Back` moved out of the JS action rows into
`headerBackTitle` and now render only under `Platform.isTV`.

The tvOS invariants are untouched and were the constraint the whole way: root
routes covering the tabs, one route per step, zero Menu handlers.

### Takeaways

- "Native back button" is a statement about the _view-controller stack_, not
  about header options. Ask which `UINavigationController` the screen is the root
  of before touching `headerShown`.
- An action carrying an explicit `target` does not bubble in react-navigation. A
  targeted `pop()` that the target cannot perform is swallowed, not escalated.
- expo-router route names are worth deriving from `getRoutesCore`, not memory:
  a `Stack.Screen name` that misses just renders default options, silently.

### Files

- `app/_layout.tsx` (`connect/quick-connect`, `connect/login` screen options)
- `app/connect/_layout.tsx` (removed)
- `components/settings/QuickConnectSection.tsx`, `components/settings/UsernamePasswordSection.tsx`

## The Mac Build: A 1x1 Park, a Screen That Is Not the Window, and a Key the System Eats (August 2026)

### Symptom

The iOS binary run by macOS ("Designed for iPad", the arm64 `Debug-iphoneos`
product) played audio with AVKit's chrome drawn correctly and showed no picture.
Resizing the window appeared to help. Later, with playback fixed, the Escape key
did nothing at all.

### Root Cause

Three separate things, and only the system log could tell them apart.

**No picture.** CoreMedia reports the size of the layer it renders into. During
startup it read `primaryVideoOutputSize 0x0`, then `1x1`, then `2338x1326`, then
`1x1` again, then `1800x1169`. The `1x1` is ours: `PlayerHost` parked its stage at
`width: 1, height: 1` while loading, and `RCTVideo.layoutSubviews` forces the
AVPlayerViewController's view to the RCTVideo's own bounds. The two large numbers
are two different coordinate spaces for the same rectangle: `2338x1326` is the
window in the app's points, `1800x1169` is the display in macOS points (the iOS on
Mac runtime scales by 0.77, and 1800 / 0.77 = 2338). react-native-video writes
`UIScreen.main.bounds` onto the presented controller (`setFullscreen`), which is
the display and not the window on a desktop, and it wins the race.

**Audio without video.** The resume seek 100ms after `onLoad` tore the video
render chain down (`fpfs_PrepareForSeek: stopping and deleting track 3`) and it
never came back. Post-seek the new video track received samples and no render
chain was ever built for it, so the clock and audio resumed and the picture did
not. The image queue's own stats said it outright: `enqueued: 1, displayed: 0`.

**Escape.** A `UIKeyCommand` with no modifiers loses to system behaviour by
default, and Escape is a key macOS reserves. The command was collected and never
invoked.

### Fix

- Park at the stage's size on the non-TV lane, moved off screen by transform
  rather than shrunk to 1x1. tvOS keeps the 1x1 park: a view above a focusable
  strands focus there, and it never presents anyway.
- Never present AVKit full screen on a Mac. Inline, React Native owns the size and
  `UIScreen` never enters the picture.
- Resume through the source's `startPosition` on a Mac, which
  react-native-video applies in `handleReadyToPlay` before a frame reaches the
  layer, instead of seeking after load.
- Escape lives on the root view controller, installed through Expo's
  `createRootViewController` extension point by a config plugin, with
  `wantsPriorityOverSystemBehavior = true`.

### What Actually Localised It

`/usr/bin/log show --predicate 'processImagePath CONTAINS "TomoTV"'`. Note the
absolute path: `log` is aliased to `git log` in this shell, and the aliased
command returns nothing, which reads exactly like "the app logged nothing".
`piqca_gmstats_dump` gives enqueued/displayed frame counts, and
`fpfsi_GetResolutionCapForFilter` gives the layer size CoreMedia believes in.
Neither can be inferred from JS logs.

### Takeaways

- On a Mac, `UIScreen.main.bounds` is the display and the app's window is a
  fraction of it, in a different coordinate space. Any geometry written from
  `UIScreen` is wrong there, and it is right on a phone only by coincidence.
- A parked view's size is not private. It reaches the decoder as a resolution cap.
- JS can never tell it is on a Mac: `Platform.isMacCatalyst` is a compile-time
  `TARGET_OS_MACCATALYST` flag, false for a Designed-for-iPad build, and the idiom
  reads `pad`. `ProcessInfo.isiOSAppOnMac` is the only answer, and it needs a
  native module (`utils/hostEnvironment.ts`).
- `prebuild:dual` prebuilds the tvOS project into `ios/` and then moves it, so an
  `ios` config-plugin mod lands in the tvOS AppDelegate too. Guard injected Swift
  with `#if os(iOS)` and assume both platforms will compile it.
- Instrument native code before asking a human to press a key. A silent handler
  makes "never fired" and "fired and went nowhere" look identical.

### Files

- `components/player-host.tsx` (parked style, `PRESENTS_NATIVE_FULLSCREEN`)
- `hooks/useVideoPlayback.ts` (`startPositionMs`, skipped post-load seek)
- `utils/hostEnvironment.ts`, `native/ios/MultiAudioResourceLoader/DeviceEnvironment.*`
- `native/ios/MultiAudioResourceLoader/MacKeyCommands.*`, `plugins/withMacKeyCommands.js`
- `services/macKeyCommands.ts`, `components/mac-key-commands.tsx`

## A Cold Launch Into /player Requests a Session Nobody Is Listening For (August 2026)

### Problem

Every playback-regression item except the first failed with "no probe events
arrived", and the simulator sat on a black screen with a spinner. The same deep
link played fine when the app was already running. Top Shelf selections from a
cold app hit the same wall.

### Root Cause

`f285fb0` moved the player out of the route into `PlayerHost`, which
`app/_layout.tsx` renders AFTER the navigator. Effects fire in tree order, so on
the one commit that mounts both — a launch whose initial route already IS
/player — the route's `requestSession` effect (`app/player.tsx:201`) runs before
`PlayerHost`'s `registerHost` effect. `bridgeRef.current` was still null and
`bridgeRef.current?.requestSession(request)` swallowed the launching request.
Its deps never change, so it never fired again: no session, no stream, and the
loading overlay (`!hasStream`) stayed up forever. Warm links work because the
host registered minutes earlier.

The suite hid it. `runItem` never cleared `playback-probe.jsonl`, and the app
only truncates it when playback ARMS the probe — which is exactly what stopped
happening. T01 read back its own events from a run eight minutes earlier and
reported PASS, so the failure looked like it started at T05.

### Solution

`PlayerSessionProvider` owns the handoff instead of leaving it to mount order.
The three commands that describe intent (`requestSession`, `setTvConfig`,
`signalRoutePresented`) are held when no bridge is registered and replayed in
that order by `registerHost`, latest value wins. `releaseRoute` and
`stopSession` cancel a held request. The two that cannot mean anything without
a live host (`pause`, `retry`) log a dropped command instead of vanishing into
a `?.`. The driver deletes the probe file before each item.

### Key Takeaways

- A `?.` on a ref that another component installs is a race, not a null guard.
  If the caller cannot retry, the provider has to hold the call.
- Any state a test reads must be destroyed by the DRIVER before the run, never
  by the code under test. Self-truncation is not a reset.
- Effect order is render order: anything mounted after the navigator is not
  available to a route on its first commit.

### Files

- `contexts/PlayerSessionContext.tsx` (held commands, flush on register)
- `contexts/__tests__/PlayerSessionContext.test.tsx` (mounts route-before-host,
  the cold-launch commit order; fails against the `?.` version)
- `scripts/playback-regression.mjs` (`fs.rmSync` on the probe file per item)
- `app/_layout.tsx`, `components/player-host.tsx` (the ordering that causes it)

---

## Leaving the Player Cost 750ms, and Both Halves Were Our Own Constants (August 2026)

### Symptom

Closing the player on iPhone left the app on a black screen for roughly 700ms
before the library was back and interactive. It read as a freeze: nothing on
screen, nothing responding.

### Root Cause

Two constants, run back to back, and neither was a hang:

1. **500ms transition.** `app/_layout.tsx` gave the `/player` screen
   `animation: "fade"` and no `animationDuration`, so react-native-screens used
   `RNSDefaultTransitionDuration = 0.5` (`RNSScreenStackAnimator.mm:10`). The
   popping screen is an opaque black `View` and the host parks itself in the
   same commit, so this was half a second of black dissolving into the library.
2. **250ms defer.** `handlePresentationDidDismiss` waited that long to find out
   whether AVKit had dismissed the presentation because PiP was starting.

The defer was waiting for an event that, if it arrives at all, has already
arrived. `RCTVideoPlayerViewController.viewDidDisappear` calls
`videoPlayerViewControllerWillDismiss` (which does
`RCTPlayerObserver.removePlayerViewControllerObservers()` ->
`playerViewController?.delegate = nil`) on the line before
`videoPlayerViewControllerDidDismiss` emits `onFullscreenPlayerDidDismiss`. The
delegate is the only route for `playerViewControllerDidStartPictureInPicture`,
so a PiP-start that lands after the dismissal is never delivered. Both are
direct events on the same view, so RN preserves their order into JS:
`pipHandoffArmedRef` is already set when the dismissal handler runs.

### Fix

`animationDuration: Platform.isTV ? undefined : 150` on the player screen, and
the PiP flag read synchronously with the timer deleted. Leaving the player went
from ~750ms of black to 150ms.

### Key Takeaways

- A perceived freeze that matches a round number is usually a sum of timeouts,
  not a blocked thread. Add up the constants on the path first.
- A default you never set is still a decision. `animation: "fade"` shipped a
  500ms transition nobody chose.
- A timer that waits for a native callback is only sound if that callback can
  still be delivered. Check where the delegate is detached before trusting the
  wait.
- Phone PiP never reports `isActive: false` after a hand-off for this same
  reason, which is why the route cannot be popped while keeping the session
  alive on iOS (`releaseRoute` detaches on tvOS only).

### Files

- `app/_layout.tsx` (the player screen's `animationDuration`)
- `components/player-host.tsx` (synchronous `pipHandoffArmedRef` read,
  `PIP_HANDOFF_BURST_MS`, PiP status logging)

---

## A Fixture Shorter Than Its Own Validation Step (August 2026)

### Problem

`npm run test:playback` reported 52/55. T43, T85 and T86 failed with
`validation error: ... Server returned 404 Not Found` against the engine's
`master.m3u8`, which reads as the on-device remuxer dying mid-item.

### Root Cause

Nothing was wrong with playback: all three chose `localRemux` and played their
files to the end. The fixtures are 10.01s, 5.92s and 4.38s long. The harness
validates against the _still-live_ session (`runItem`, near the end), and
`validateRemuxOutput` opens with an unconditional `ffprobeStreams(masterUrl)`.
By then the player had reached EOF, the player screen had unmounted, and the
local HLS server was gone. T84 (6.0s) passed only because it exits the poll loop
on its `playSeconds` timer rather than on `ended`, so ffprobe usually beat the
teardown.

The lane was never reliable. The `expect: { subtitles: N }` blocks that make
these `validate: "none"` items probe at all arrived in 6d0c95c.

### Solution

Start the probe while the session is guaranteed up. For
`mode === "localRemux" && validate === "none" && expect`, the poll loop kicks
off `validateRemuxOutput` as soon as both the `stream` and `enginePlan` events
are present, and the post-loop block awaits that in-flight promise instead of
starting a new one. The hash lanes (`copy`, `devtc`) still validate after the
loop because they compare a filled 30s window against a recorded baseline.

Measured, not assumed: the engine URL appears ~2.2s after the deep link, and a
live ffprobe takes 1.43s on T85 (19 streams) and 0.20s on T86 (12 streams).

### Key Takeaways

- Validation that requires a live server must start while the server is live.
  "After playback" is not a time that exists for a 4s fixture.
- A test that passes on a race still passes, right up until it doesn't. T84 was
  the same bug with better luck, and it was one slip from red.
- Before believing a suite's verdict about the app, confirm the suite is talking
  to the same server the app is. `lsof -a -p <pid> -i` on the simulator process
  names the host in one line.
- Re-run a single failing id with `--only` and read the probe file. It carries
  the mode, the engine plan, every progress sample and the `ended` event.

### Files

- `scripts/playback-regression.mjs` (`probeWhileLive` / `liveValidation` in
  `runItem`; `validateRemuxOutput` unchanged)
- `test/playback/manifest.json` (the `validate: "none"` items: T06, T43, T84,
  T85, T86)

---

## The Engine's Ceiling Was a Missing Library, Not a Codec List (August 2026)

### Problem

The on-device engine was documented as covering "H.264/HEVC plus the legacy
long tail, up to 1080p, 8-bit, progressive". Everything outside that went to the
server: 10-bit, interlaced, ProRes, MJPEG, FFV1, every audio-only file AVPlayer
could not open, and any file carrying one audio track with no decoder. For a
product whose whole position is native playback, that was a large amount of
server transcoding nobody had counted.

### Root Cause

`VideoTranscoder` refused any decoded frame that was not exactly 8-bit
`yuv420p`/`nv12`, at init on the container's claim and again on the first frame.
The refusal was correct given its inputs: `h264_videotoolbox` accepts only those
two, and there was no way to convert, because **Libswscale was never vendored**.
`scripts/fetch-mpvkit.js` fetched four FFmpeg libraries and swscale was not one
of them.

That single omission explains the whole gap list. Audio had no equivalent
ceiling precisely because Libswresample _was_ vendored, so `AudioTranscoder`
could convert any format, rate or layout — which is why the audio allowlist was
long and the video one short.

### Solution

Convert with **VideoToolbox**, not libswscale. Libswscale turned out to be
unvendorable: MPVKit builds FFmpeg with `--enable-vulkan`, and FFmpeg 8 moved
scaling onto an "ops" dispatcher that references a Vulkan backend referencing
shaderc, so `sws_alloc_context` + `sws_scale_frame` alone will not link. Vendoring
it broke the tvOS build for half a day. Apple ships the same capability with
nothing to add: wrap the decoded planes in a `CVPixelBuffer` and convert with a
`VTPixelTransferSession`.

With conversion available, the gates the refusal had forced came out: bit depth
(10-bit now opens `hevc_videotoolbox` with `p010le`, which was registered and
never called), interlacing, the every-audio-track-must-be-carriable rule, the
audio-only exclusion, and the missing decoders in both allowlists.

### Key Takeaways

- When a component refuses a lot of input, check what it was **given** before
  concluding what it can do. The refusal was a symptom of the build, not a
  design.
- A dependency list is a capability boundary. Four of six FFmpeg libraries
  drew a line through the product's core feature and nothing in the docs said so.
- Verify a claim at the line, not at the line number. Three of this session's
  findings were wrong in the direction of "sounds right, reads wrong".

### Files

- `scripts/fetch-mpvkit.js`, `native/ios/TomoFFmpeg.podspec` (vendoring)
- `native/ios/LocalRemuxer/VideoTranscoder.swift` (conversion, 10-bit, deinterlace)
- `native/ios/LocalRemuxer/Remuxer.swift` (`hasVideo`, video-less sessions)
- `services/localRemux.ts`, `services/jellyfin/media.ts`, `hooks/useVideoPlayback.ts`
- `memories/CLAUDE-playback-engine.md` (the authority this should have had)

---

## The Info Panel Asked a Playback Question About a Photo (August 2026)

### Problem

Long-pressing a photo opened the info panel on "Couldn't load details for X."
The same error hit any Series card long-pressed from a home shelf. Movies,
episodes and audio were fine.

### Root Cause

`fetchVideoDetails` led with `GET /Items/{id}/PlaybackInfo` and treated it as
the load. Probed against the live server (Jellyfin 10.11.11), that endpoint
returns **HTTP 500** for both `Photo` and `Series` — not an empty result, a
server error. `retryWithBackoff` then spent three round trips on it before the
panel gave up, so a photo cost three failing requests to display nothing.

`GET /Items/{id}` answers 200 for every one of those kinds and carries what the
panel actually renders: Name, Path, Width/Height, DateCreated, Album, ParentId,
ImageTags, UserData. The panel had been asking the one question its subject
could not answer, and discarding the answer it could.

Two smaller faults rode along:

- `predictPlaybackLane` ran inside the same `try` as the load, after
  `setDetails`. A throw there flipped the whole panel to the error state with
  the details already in hand.
- `canRemuxLocally` declines anything without media streams, so the lane line
  would have stamped "Transcoded by the server" on a photo and on a series
  folder — neither of which is transcoded by anything.

### Solution

`fetchItemDetails` in `services/jellyfin/items.ts`: metadata first, sources
second, and sources only for `PLAYABLE_ITEM_TYPES`. A failure on the
PlaybackInfo leg logs and returns the item, so losing streams never costs the
panel the title, artwork and file line it already holds. Its cache key extends
the existing `details:` prefix, so the user-data evictions in `cacheKeys.ts`
drop it without a new rule.

The panel gained a **Details** table built by `buildDetailRows`: every populated
fact the other sections do not already show — dimensions, album, artist, studio,
child counts with the unplayed remainder, camera, exposure, GPS, tags,
release/added/latest-media/last-played dates, play count. Empty rows are
filtered out, so each kind contributes what it has and a kind added later is
covered without new code. Photos also get the viewer (not the player) behind the
CTA, and the container is read off the path extension when there is no media
source. Lane prediction is gated on `MediaStreams?.length` and moved into its
own `try`.

Two things only real data would have shown: the server sends `0001-01-01` as
"never" for `DateLastMediaAdded` on folders that have none, and `Container`
exists at the item's top level, not only inside `MediaSources`.

### Key Takeaways

- **A 500 is not an empty result.** Probe the endpoint for each item kind before
  deciding what a failure means; the error path was built for a data condition
  that never occurred.
- **"I cannot verify the units" is a reason to go read the source, not a reason
  to ship less.** The first pass dropped aperture and shutter because Jellyfin's
  field names do not state a convention. `Emby.Photos/PhotoProvider.cs` settles
  it in four lines: both are assigned raw from EXIF ApertureValue and
  ShutterSpeedValue, so both are APEX — f = sqrt(2^APEX), seconds = 1/2^APEX.
- A table built by filtering a row list beats per-kind branches. One array
  covers photo, folder, episode and audio, and nothing renders an empty row.
- Every kind reachable by long press must survive the panel. `useItemLongPress`
  has no type guard, and `item-shelf` hands folders the same handler.

### Files

- `services/jellyfin/items.ts` (`fetchItemDetails`)
- `app/video-info.tsx` (Details table, photo CTA, meta lines, lane gate)
- `utils/mediaInfo.ts` (`buildDetailRows`, `formatPixelSize`, `formatMediaDate`,
  `formatExposure`, `formatCoordinates`)
- `types/jellyfin.ts` (photo, EXIF and folder-count fields)

---

## A Library That Lists Videos It Does Not Own (August 2026)

### Problem

Playing any video from the "Home Videos and Photos" library root produced no Up
Next: no tvOS content proposal, no phone interstitial. Device log:

```
Building play queue {"folderId":"ee75511a…","folderName":"Home Videos and Photos"}
Fetched recursive videos for queue {"parentId":"ee75511a…","totalVideos":0}
WARN No videos found for queue
```

Playing the same file from inside its subfolder worked.

### Root Cause

Not the app's filter. Measured against 10.11.11, on that `homevideos`
CollectionFolder:

| Query                                                       | Result                  |
| ----------------------------------------------------------- | ----------------------- |
| non-recursive (what the grid shows)                         | 60 items, **21 videos** |
| `Recursive=true` alone                                      | 93 items, **0 videos**  |
| `Recursive=true&MediaTypes=Video,Audio` (the queue's query) | **0**                   |

The videos are not owned by that library. `/Items/{id}/Ancestors` on one of them
walks `Pipos → Movies (CollectionFolder) → Media Folders`. A homevideos view
LISTS them non-recursively, but a recursive sweep resolves through real
ownership, where they belong to a different library. So the grid displays videos
the recursive query provably cannot reach.

`fetchRecursiveVideos` returned `[]`, `playQueueManager.buildQueue` took its
`items.length === 0` branch and set `currentIndex = -1`, so `hasNext` was false
and neither Up Next surface could arm.

### Solution

`fetchRecursiveVideos` paginates through a `fetchPages(recursive)` helper and,
when the recursive sweep returns nothing, retries once without `Recursive`.
Every filter is unchanged on the retry. The direct children are what the grid
displayed, so they are the honest queue for that root, and `nextUp.ts` shares
the function so the Continue Watching next-up card benefits too.

Replayed against the live server afterwards: Home Videos 21 via fallback (the
tapped item at index 0, `hasNext` true), Landscapes still 0 because it genuinely
holds only photos, and Local 43 / Movies 192 / Open Videos 5 / Music 62 all
still take the recursive path untouched.

### Key Takeaways

- **When a list and its recursive sweep disagree, trust the list.** The user can
  see those items; a queue that cannot is the thing that is wrong.
- An extra round trip only on the empty path costs nothing where it already
  works, and a fallback gated on "the answer was empty" cannot regress a
  non-empty answer.
- A folder with genuinely no videos still returns empty after the retry, so the
  fix does not invent a queue where there is none.

### Files

- `services/jellyfin/items.ts` (`fetchRecursiveVideos`, `fetchPages`)
- `services/playQueueManager.ts` (the `items.length === 0` branch this feeds)
- `services/__tests__/jellyfinApi.test.ts` (fallback coverage, `mockEmptyResponse`)

## An Adult Film Poster Reached the App Store Capture Library (August 2026)

### Problem

The cubita test library rendered a mix of portrait posters and landscape stills, so the
App Store grids looked broken. Clearing the landscape sidecars so Jellyfin would pull
provider artwork fixed the aspect ratios and pulled a Japanese adult film poster onto
"Neon District", in the library used for App Store screenshots.

### Root Cause

Two independent faults. The sidecars named `<title>-poster.jpg` were landscape video
frames, and Jellyfin treats a sidecar as the Primary image over any provider poster.
Removing them let TheMovieDb match on title alone, and the Short Films items carry
generic names (Machine, Sunny, First Snow, Neon District) that collide with unrelated
real films. Nothing in the pipeline inspects what an image depicts.

### Solution

Restored the sidecars, cleared `ProviderIds` and set `LockedFields` so the matches
cannot return. Titles with distinctive names were pinned to a verified TMDb id instead
of accepting the first result: the auto-match offered the 2001 Vin Diesel film for the
1954 Corman "The Fast and the Furious". Generic-named shorts got posters built from
their own footage, pushed with `POST /Items/{id}/Images/Primary`, because setting the
sidecar alone does nothing until a metadata refresh, and that refresh re-searches
providers.

### Key Takeaways

1. Every aspect-ratio check reported `PORTRAIT, fixed`. Metrics cannot see what an
   image depicts, so artwork changes are verified by downloading and viewing them.
2. Auto-match is only safe for a distinctive title, and even then pin the provider id
   explicitly rather than taking the first candidate.
3. Wrong years block matching silently and fall through to the Screen Grabber: 1938 vs
   1941, 1955 vs 1954, 1967 vs 1968 left three films with no genre and a frame grab.
4. Check IP before featuring content. BOTW Guardian is Nintendo fan art.
5. A `media/` NFO backup is separate from the Jellyfin `config` tar; neither covers the
   other.

### Files Affected

- `/opt/tomotv/media/Short Films/*-poster.jpg` (cubita host, not this repo)
- `applestore/shots.config.json` (04-downloads slot added)

## A Logo Width That Assumed Portrait Gutters (August 2026)

### Problem

On iPhone in landscape the info panel's title logo rendered oversized and clipped at
the right edge on wide marks, and sat about 59pt right of centre on narrow ones.
Portrait was correct.

### Root Cause

`app/video-info.tsx` padded the title wrap with `paddingLeft: 20 + insets.left` /
`paddingRight: 20 + insets.right`, but sized the logo `Image` at `heroWidth - 40`.
The two agree only while `insets.left`/`insets.right` are 0. In landscape a notched
iPhone reports 59 a side, so the image box was 118pt wider than the box it sat in and
started 59pt further right: `contentFit="contain"` then resolved against a box wider
than the screen, so a wide logo bound on width (drawn larger, overrunning the right
edge) and a narrow one stayed height-bound inside an off-centre box.

### Solution

Derive the width from the same numbers the padding uses:
`heroWidth - (IS_TV ? 0 : 40 + insets.left + insets.right)`. The TV branch keeps its
full-bleed width, which its `marginHorizontal: -48` already balances against the wrap's
48pt padding.

### Key Takeaways

1. A fixed child width beside inset-aware parent padding is a landscape bug waiting for
   a rotation. Compute both from one expression.
2. `contentFit="contain"` cannot clip on its own. A clipped image means its frame left
   the parent, so measure the frame before suspecting the fit mode.
3. Two symptoms (huge, or slightly off-centre) came from one defect: which one shows
   depends only on whether the mark's aspect ratio binds on width or on height.

### Files Affected

- `app/video-info.tsx`

---

## Remove All Cleared the Flag the Screen Renders On (August 2026)

### Problem

Clearing every download from the storage gauge left the Downloads tab blank: the ambient
background with nothing on it, no list, no empty state, no gauge. It stayed blank for as long as
the tab remained mounted.

### Root Cause

`removeAll()` ended with `this.hydrated = false; this.hydrating = null;`. The screen gates its
whole body on that flag (`{!state.hydrated ? null : ...}`), so the notify that followed rendered
`null`. Nothing puts it back: `hydrate()` is called from a mount effect and once at launch, and
neither fires again on a screen already mounted.

The empty card the press should land on was written for this exact path and had never once been
reachable. Its comment says so: "Remove All empties the list in place, and the section it emptied
should still be there, holding what to do about it."

### Solution

Delete the two lines. `hydrated` means the disk has been read, and it has been: the manifest was
flushed empty and `resetManifestCache()` set `entries = {}`, which is the truth. A regression test
asserts `getState()` is `{ entries: [], hydrated: true }` after `removeAll()`, and it was run
against the old code first to confirm it fails there.

### Key Takeaways

- A flag named for a fact ("the disk has been read") must not be recycled as a signal for an
  action ("re-read the disk"). Nothing was listening for the second meaning.
- An unreachable branch with a confident comment is a bug report nobody filed. The comment
  described intended behaviour that the code one file away had been defeating.
- A regression test that has never been seen to fail is not yet a regression test. Restore the
  old line, watch it go red, then revert.

### Files Affected

- `services/downloads/manager.ts`
- `services/__tests__/downloads.test.ts`

## A Subtitle Track That Advertised Itself and Drew Nothing (August 2026)

### Problem

T06 and T43 played with no subtitles at all. T05 (SUBRIP) was fine, and so were T85 and T86,
which carry 13 and 4 PGS tracks between them. The engine harvested the track, served its
manifest, and the app fetched it. The manifest held zero display sets.

### Root Cause

Both broken files are mkvmerge output, and mkvmerge deflates subtitle tracks by default. T06's
PGS track holds 27,277 bytes in the container that extract to 100,419 bytes of real PGS: a 3.68x
deflate, declared by an empty `ContentCompression` element whose `ContentCompAlgo` therefore
takes its default of 0, zlib.

Our FFmpeg is configured `--disable-autodetect` and never asked for zlib, so `CONFIG_ZLIB` was 0.
`matroskadec.c` logs "Unsupported encoding type", sets the encoding out of scope, and passes the
still compressed bytes through untouched. `pgs_frame_merge` then cannot parse a segment and the
decoder yields nothing. Every one of those lines was in the device log and had been for days.

T85 and T86 kept working because their PGS is uncompressed, which is why the feature looked
healthy for eight days after the build swap that introduced the gap.

### Why Nothing Caught It

`expect.subtitles` counts the renditions the master playlist ADVERTISES. The engine advertised
the PGS track correctly the whole time; it just drew nothing into it. Counting tracks and
counting pixels are different claims, and only the first had an assertion. T06 runs the engine
lane in the suite and stayed green throughout.

`npm run probe:codecs` failed closed on the same missing symbols once zlib was enabled, because
its own link line mirrors the podspec and had the same omission. That is the harness working:
it refused to report a codec set it could not link.

### Solution

`--enable-zlib`, plus libz named in `TomoFFmpeg.podspec` and in the probe's link line. The app
build is itself a check here: without the podspec entry it fails to link on `_inflate` and
`_uncompress`. Decoder count went 497 to 519, the 22 additions being the video codecs zlib gated.

`expect.imageSubtitleSets` now reads the engine's own display-set manifest (`pgsN.json`, resolved
off the master the same way `validateSubtitleSync` resolves sibling playlists) and fails when a
track decodes to zero. It fails closed: a manifest it cannot fetch counts as zero sets.

### Key Takeaways

- A build flag removed by a dependency swap is invisible until a file exercises it. The swap
  happened four days after the feature shipped and neither event mentioned the other.
- Assert on the output, not on the declaration. Advertising a track proves the playlist is well
  formed and says nothing about whether a decoder produced a byte.
- A fixture named for the lane it used to take (SERVER) will be read as taking that lane. Check
  the manifest, which said `localRemux`, not the filename.
- Verify a claim about history against the repo before stating it. Two readings of this timeline
  were wrong until `test/playback/manifest.json` and a fixture scan settled them.

### Files Affected

- `scripts/ffmpeg/build.sh`
- `native/ios/TomoFFmpeg.podspec`
- `scripts/probe-codecs.mjs`
- `scripts/playback-regression.mjs`
- `test/playback/manifest.json`
