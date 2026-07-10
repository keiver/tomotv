# Lessons Learned

**Last Updated:** June 30, 2026

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
