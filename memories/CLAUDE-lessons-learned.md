# Lessons Learned

**Last Updated:** July 30, 2026

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

## tvOS Menu Backgrounds the App on the Audio Player (July 2026)

### Problem

On Apple TV, pressing Menu on the player while an AUDIO file played suspended the app to the home screen ("app closes, unrecoverable"). Video playback popped back to the folder correctly. Same player component for both.

### Root Cause

A pushed react-native-screens screen pops on Menu ONLY when tvOS focus sits inside it — no library implements the pop (react-native-screens has zero Menu handling; react-native-tvos ships its menu recognizer disabled); it is UIKit walking the FOCUSED view's responder chain to the navigation controller. Video's AVPlayerViewController transport UI is focusable, so focus lives in the screen and Menu pops. Audio-only playback renders no focusable UI at all (AVKit's audio presentation exposes none; the poster overlay is `pointerEvents="none"`), so focus was stranded, the press reached nothing, and the system default applied: background the app. Surfaced by the fullScreenModal → push change (`e0b30bb`): modal dismissal on Menu never depended on focus, so audio worked as a modal and broke as a push.

### Solution

An invisible absolute-fill focus anchor (the library-grid `focusHolder` pattern) rendered on the player only for `Platform.isTV && isAudioOnly`. Focus stays in the pushed screen, Menu pops natively, zero menu handlers.

### What Went Wrong

- ❌ First fix: `useTVEventHandler('menu')` alone — dead code; menu events never reach JS without `enableTVMenuKey` (`RCTTVRemoteHandler.m`: `__useMenuKey = NO` by default)
- ❌ Second fix: `enableTVMenuKey` + handler — JS pop races the same press's native delivery and pops two levels; a once-per-mount guard did not save it. Re-learned the e136575 lesson: JS menu interception always fights UIKit
- ❌ Shipped both fixes on assumed event-delivery mechanics instead of reading `RCTTVRemoteHandler.m` first

### What Worked

- Sampling the "frozen" process (healthy, idle main thread → suspended, not crashed) and crash-report absence to rule out native failure
- Reading the actual sources (react-native-screens iOS, RCTTVRemoteHandler.m, the react-native-video patch) until every link of the chain was verified
- Reusing the codebase's own focus-holder pattern instead of inventing a handler

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

### What Went Wrong

- Tried `disabled={!isConnected}` as a lighter alternative to `hidden` — worse: select-then-eject focus race on tvOS
- Mounting the native `TvosSearchView` while the Search screen was displayed (login via a CTA on the Search screen itself) came up with no search field — the logged-out Search view must not offer a connect CTA that flips state mid-view

### What Worked

- Discriminating experiment: relaunch after login (fresh navigator mount) showed no border, proving the runtime remount was the trigger
- Reusing the Library tab's exact component + data hook for the logged-out Search view, instead of a lookalike copy

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

### What Went Wrong

- First attempt tried `Keyboard.dismiss()` + `.blur()` cleanup in settings.tsx `useFocusEffect` — this was a red herring because the issue wasn't a lingering first responder on the JS side
- The real issue was a missing Apple-documented UIKit pattern in the native Swift library

### What Worked

- Reading Apple's documentation on UIHostingController containment requirements
- Tracing the lifecycle: Settings TextInput -> UIAlertController -> focus engine state change -> missing VC hierarchy -> .searchable can't reclaim focus

### Key Takeaways

1. **UIHostingController requires proper child VC containment** — adding just the `.view` as a subview is not sufficient. Without `addChild`/`didMove(toParent:)`, SwiftUI never receives lifecycle events
2. **"Works on first launch but breaks after X" is a containment/lifecycle smell** — if something works initially but breaks after unrelated UIKit interactions, suspect missing lifecycle integration
3. **Focus engine bugs on tvOS are often VC hierarchy bugs** — the tvOS focus engine relies on the view controller hierarchy to route focus. If a VC isn't in the hierarchy, its views can't participate in focus updates

### Files Affected

- `expo-tvos-search/ios/ExpoTvosSearchView.swift` (library fix)
- `app/(tabs)/settings.tsx` (defensive cleanup, kept but not the fix)

---

## Audio Track Label Bug (January 2026)

### Problem

tvOS showed "Unknown language" instead of track name for undefined language tracks in the native audio picker.

### Root Cause

iOS/tvOS **ALWAYS prioritizes LANGUAGE attribute** over NAME for display in native picker. When LANGUAGE="und" (undefined), iOS displays its own localized string "Unknown language" regardless of what NAME says.

### Solution

Omit LANGUAGE attribute entirely for "und" tracks. Per RFC 8216, LANGUAGE is OPTIONAL. When LANGUAGE is omitted, iOS falls back to displaying the NAME attribute.

### What Went Wrong

- ❌ Proposed solutions without reading Apple HLS spec
- ❌ Assumed LANGUAGE was required (it's optional per RFC 8216)
- ❌ Went in circles trying NAME variations without understanding root cause
- ❌ Forgot platform context (iOS HLS ≠ generic HLS)
- ❌ Didn't read the actual Swift implementation before suggesting changes

### What Worked

- ✅ Read RFC 8216 to confirm LANGUAGE is optional
- ✅ Read Apple HLS Authoring Specification
- ✅ Inspected actual Swift code in `native/ios/MultiAudioResourceLoader/`
- ✅ Tested one solution at a time with clear hypothesis
- ✅ Asked user for confirmation before implementing

### Key Takeaways

1. **Display and auto-selection are separate concerns:**
   - LANGUAGE/NAME control what's displayed in picker
   - DEFAULT/AUTOSELECT control which track plays automatically
2. **Platform-specific behavior requires platform-specific documentation:**
   - Generic HLS specs (RFC 8216) define what's allowed
   - Apple HLS implementation defines actual behavior on iOS/tvOS
3. **Read implementation code BEFORE proposing solutions:**
   - Assumptions about how code works are often wrong
   - 5 minutes reading Swift code saves hours of iteration

### Files Affected

- `native/ios/MultiAudioResourceLoader/HLSManifestGenerator.swift:156-180`

### Commit

- Hash: 703c7a2
- Message: "fix: audio tracks show correct name, no default selected mark in list tradeoff"

---

## Compliance Test Anti-Pattern (January 2026)

### Problem

AI-generated tests sometimes use `fs.readFileSync` to scan source code files and assert on string presence/absence, rather than testing actual runtime behavior. These "compliance tests" provide false confidence and test nothing meaningful.

### Root Cause

When asked to verify a code property (e.g., "ensure no console.log statements"), the path of least resistance is to read the source file and check for string patterns. This satisfies the request superficially but doesn't exercise any code paths.

### Solution

Established a rule: **all tests must exercise actual code paths.** If the only way to verify something is scanning source text, use a linter rule instead or skip the test entirely. No test is better than a fake test.

### What Went Wrong

- ❌ Used `fs.readFileSync` in test files to scan source code
- ❌ Asserted on code text patterns instead of runtime behavior
- ❌ Created tests that pass/fail based on string matching, not functionality
- ❌ Provided false confidence that "everything is tested"

### What Worked

- ✅ Identified the anti-pattern and documented it
- ✅ Added explicit rule to testing best practices
- ✅ Audited all existing test files for violations (none found)
- ✅ Clear guidance: use ESLint for code style, Jest for behavior

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

Caught the error when the user asked for verification. Research confirmed the claim was false. The implementation (adding/removing a non-focused temporary focusable view) is almost certainly a no-op — UIKit has no reason to do anything when a view that never had focus is removed.

### What Went Wrong

- ❌ Implemented a plan without verifying its core assumption
- ❌ Wrote "Per Apple docs" in code comments without reading Apple docs
- ❌ Treated the plan's assertion as fact and coded it without due diligence
- ❌ The plan itself had ~50% confidence but the code comments stated it as documented fact
- ❌ Violated the Research-First Protocol from CLAUDE.md

### What Worked

- ✅ User asked a direct yes/no verification question
- ✅ Fetched actual Apple documentation (App Programming Guide for tvOS, WWDC 2016/2017 transcripts)
- ✅ Found the exact discrepancy: "focused view" vs "any focusable view"
- ✅ Admitted the error immediately and transparently

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

### What Went Wrong

- ❌ [Anti-pattern we fell into]
- ❌ [Assumption we made]

### What Worked

- ✅ [Process that led to solution]
- ✅ [Tool or technique that helped]

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

### What Worked

- ✅ Traced the native write path (legacy Swift module) instead of guessing at JS.
- ✅ Confirmed the platform from `project.pbxproj` (`SDKROOT = appletvos`) before concluding.
- ✅ Separated the scoped-permission check (passed) from the OS write (failed) via the `causedBy` error chain.

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

### What Went Wrong

- ❌ Spent many build/test cycles fighting the platform: `enableTVMenuKey` + `useTVEventHandler`, a
  native gesture-recognizer interceptor, `setNeedsFocusUpdate` focus-restore,
  `tabBar.isUserInteractionEnabled = false`, `TVFocusGuideView trapFocusUp`, grid remount-for-focus.
  Every one failed — they all fight `UITabBarController`'s built-in Menu behavior.
- ❌ Assumed/guessed tvOS focus mechanics instead of reading them, and shipped fixes without watching
  the result on a device.
- ❌ Broke the Keychain by installing unsigned `xcodebuild CODE_SIGNING_ALLOWED=NO` builds over the
  signed one (entitlements stripped → SecureStore failed).

### What Worked

- ✅ Researching the platform's intended pattern (react-native-tvos maintainers discussion #493: the
  Menu key "must not have an attached gesture handler"; Expo docs: nest a Stack inside native tabs;
  the official `ExpoRouterTV` demo) — this was the actual solution and should have come first.
- ✅ Driving the tvOS simulator empirically (`osascript` keystrokes for select/Menu +
  `xcrun simctl io … screenshot`) to SEE focus state instead of theorizing.

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

### What Went Wrong

- ❌ Assumed `ios.infoPlist` overrides always win (they win the base merge, but any plugin
  that assigns to `infoPlist` afterwards still clobbers them)
- ❌ First diagnosis blamed the config/plist mismatch on prebuild defaults instead of
  tracing which plugin wrote the value

### What Worked

- ✅ `EXPO_TV=1 npx expo config --type introspect --json` to see the resolved plist without
  a full prebuild
- ✅ `npx expo prebuild -p ios --no-install` for a fast empirical check (skips pod install;
  ios/ is gitignored)
- ✅ Grepping node_modules plugin sources for the literal value ("Automatic") to find the
  writer

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

### What Went Wrong

1. Blamed server data (stale ancestor index) from code reading alone; a library rescan disproved it.
2. Two plan iterations argued from Jellyfin source instead of measuring. One probe script against the real server settled it in seconds: every variant x every library, real numbers.
3. The regression was bisectable from branch history the whole time (`3db189e` worked, `1d028d7` broke it).

### What Worked

- Bisecting the branch history to isolate the exact parameter change
- A throwaway probe script running all query variants against every real library and comparing `TotalRecordCount`

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

### What Went Wrong

- ❌ Fixed focus **position** (requestTVFocus re-anchor, hasTVPreferredFocus tweaks, "button holds initial focus") four times while the real bug is in focus **traversal** — native, not JS. Every JS-only attempt failed intermittently, exactly as the Jan 2026 entry warned.
- ❌ Ignored the repo's OWN lessons-learned, which already documented this native gate and that JS fixes don't work.
- ❌ "Verified" a fix from a single sim screenshot instead of a hammer test — the bug is intermittent, so one success proved nothing.
- ❌ Added `flex:1` to the FlatList when moving the header to a sibling → blanked the screen (search's list has no flex).

### What Worked

- ✅ Reading the installed native `.mm` and confirming the gate exists at the exact lines in 0.85.0-0.
- ✅ Cross-referencing upstream react-native-tvos issues (#849/#670/#839/#204/#815) to explain the intermittency and the Fabric/native-stack triggers.
- ✅ Diffing against `search.tsx` (the one reliable focus screen) to see the structural difference: up-target inside vs outside the scroll view.

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

### What Went Wrong

- ❌ First pass replaced `Promise.any` with `Promise.allSettled` to collect per-candidate errors, which would have made every successful connect wait out the candidates that time out. `AggregateError.errors` preserves candidate order, so the race needed no change.
- ❌ First pass gave the 404 path its own message (`Server returned 404`), silently changing user-facing text and breaking an existing assertion. Structured reasons belong on the error object, not in the message.
- ❌ Clamped the sweep mask with `mask | 0x000000ff` (sets the low bits, forcing a /32) instead of `mask | 0xffffff00`. Produced zero hosts; caught only because a test asserted the host count.
- ❌ Excluded the device's own address from the sweep as a micro-optimisation, one probe out of ~500. On the simulator the "device" IP **is** the host Mac's, so this skipped the exact address a dev-machine Jellyfin runs on, and the feature found nothing in the one environment it actually gets tested in. The warm-up probe was hitting that address, getting a 200, and discarding it.

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

### What Went Wrong

- ❌ Verified "decoder exists in the linked FFmpeg" with `nm` on the static
  archives. The msmpeg4v1/v2/v3 symbols are present — as dependencies of
  wmv1/wmv2 — but the codecs were never REGISTERED in the MPVKit build, so
  `avcodec_find_decoder` returns NULL and the pipeline failed at runtime.
- ❌ Copied MP3 audio through into fMP4. Apple's HLS spec allows MP3 only in
  MPEG-TS segments; AVPlayer refuses an fMP4 stream whose audio sample entry
  is `.mp3` with a bare "Cannot Open". Every prior test file happened to carry
  AAC or a codec we already transcode.
- ❌ Believed "fragment timestamps (tfdt) carry absolute position." The mov
  muxer normalizes every track's timeline to the first packet each muxer
  instance sees, so every seek-restart generation wrote fragments claiming the
  file starts at t=0. All previous seek tests passed only because AVPlayer's
  entire buffer happened to come from a single generation; an Xvid AVI whose
  early segments survived the prune window produced a mixed-generation buffer
  and the playhead jumped +20s. Latent in the shipped copy path too.
- ❌ Substring codec matching admitted impostors twice: `"atrac3".includes("ac3")`
  and `"msmpeg4v3".includes("mpeg4")`. Both caught by unit tests, both fixed by
  switching to prefix matching.
- ❌ A failed `avformat_seek_file` was logged and ignored, leaving the producer
  to stamp whatever content came next with the requested segment's timestamps —
  or hang the request for the full 20s timeout (VP6 AVI with a defective index).

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

### What Went Wrong

- ❌ Trusted addTarget's return value as proof the dependency existed; only a
  pbxproj grep for `dependencies = (` revealed the empty list.
- ❌ Verified embedding with a relative `ls` from the wrong cwd (repo root vs
  ios/) and nearly diagnosed a working build as broken. Products lived under
  ios/build/full because the background xcodebuild started from ios/.

### What Worked

- ✅ Reading pbxProject.js at the exact call site instead of assuming the
  library API works — the `if (pbxContainerItemProxySection && ...)` no-op guard
  is visible in 10 lines.
- ✅ Building the extension target directly
  (`xcodebuild -project TomoTV.xcodeproj -target TopShelf -sdk appletvsimulator
CODE_SIGNING_ALLOWED=NO`) — fast iteration, no pods, surfaced the bridging
  header and Swift `Type` reserved-name errors in seconds.

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
