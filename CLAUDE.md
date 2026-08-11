# CLAUDE.md

**TomoTV** is a Jellyfin video streaming app built with React Native TVOS and Expo, targeting Apple TV (tvOS) and iOS. It handles codec detection, automatic transcoding, and multi-audio track switching via a custom Swift native module.

## Communication Format

Add 10 blank lines BEFORE and AFTER response text for visual breathing room in terminal.

## First Message Protocol

On every new task:

1. Restate it, identify affected files/systems, ask if ambiguous
2. Check prerequisites: files to read, CLAUDE-\*.md files to load
3. Present approach with file list, ask for confirmation
4. Wait for confirmation, then execute

## Tool Selection Matrix

| Scenario                         | Tool            | Why                        |
| -------------------------------- | --------------- | -------------------------- |
| "Where is X implemented?"        | Task (Explore)  | Always use, be aggressive  |
| "Read this specific file"        | Read            | Direct, no overhead        |
| "Find all uses of function Y"    | Grep            | Exact matches, fast        |
| "Understand how feature Z works" | Task (Explore)  | Always use, be aggressive  |
| Need to edit multiple files      | Edit (parallel) | Batch edits in one message |

Be aggressive with Task (Explore) for codebase questions. Don't ask permission, just use it.

## Platform Context

- **Primary Platform:** iOS/tvOS (React Native TVOS, Swift, AVPlayer, HLS)
- State platform upfront in every technical discussion
- Native behavior != web behavior
- AVPlayer is the native video player (not web player)
- HLS manifest rules follow Apple's implementation (not generic HLS)
- Swift modules require rebuild via `npm run prebuild:tv`

## Decision Thresholds

**MUST ASK:** Changes affecting >3 files, breaking API changes, new dependencies, platform-specific uncertainty, multiple valid approaches with tradeoffs.

**CAN PROCEED:** Single-file bug fixes, adding tests, refactoring with identical behavior, documentation updates, obvious type errors.

## Anti-Loop Protection

- Track failed approaches internally
- Never retry the same solution twice without new evidence
- After 2-3 failed attempts: STOP, ask user for guidance
- If context seems lost: re-read relevant CLAUDE-\*.md, ask "What was our last confirmed decision?"
- Red flags: "Let me try X again" (if X failed), proposing solutions without reading specs/code

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

**Testing and Components:**

- "testing" / "tests" / "coverage" / "jest" -> `memories/CLAUDE-testing.md`
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

Category loading: "all implementation docs" (8 files), "deployment docs" (3 files), "all memory files" (15 files).

You don't need to tell me to read these files.

## Lessons Learned

See `memories/CLAUDE-lessons-learned.md` for detailed case studies.

**Auto-Append Policy:** After resolving a significant bug/issue, automatically append a new lesson using the template in that file. No need to ask permission.

## Development Commands

```bash
npm start                         # Refreshes dev IP and starts Metro/Expo
npm run ios                       # Build and run on iOS simulator
npm test                          # Run all tests once
npm run test:watch                # Watch mode for tests
npm run test:coverage             # Generate coverage report
npm run lint                      # Lint and auto-fix with ESLint
npm run prebuild                  # Clean native prebuild
npm run prebuild:tv               # Prebuild with Apple TV support (EXPO_TV=1)
```

## Native Code Development

**CRITICAL: Always edit files in `native/` folder, NOT `ios/` or `android/` folders!**

`npm run prebuild:tv` deletes and regenerates `ios/`/`android/`. Native source files are copied from `native/ios/` during prebuild. Edits to `ios/` directly will be lost.

Workflow: Edit in `native/ios/MultiAudioResourceLoader/` -> `npm run prebuild:tv` -> `npm run ios`

## Code Quality Standards

- Type safety (no `any` without justification)
- Error handling (try-catch around async operations)
- No scale animations on grid items (performance rule)
- No over-engineering, no premature abstraction

## Known Issues

1. The on-device engine (native/ios/LocalRemuxer) plays H.264/HEVC in any container by stream copy, and VP8/VP9/MPEG-1/2/4, WMV, VC-1, H.263, FLV, RealVideo, VP6 by VideoToolbox transcode (gated to ≤1080p-class, 8-bit, progressive). Server-side transcoding remains only for: 4K/8K and 10-bit exotic codecs, interlaced sources, DivX 3/Theora (no registered decoder in the linked FFmpeg), and subtitle burn-in (image subs only: forced TEXT tracks ship as selectable HLS renditions and no longer force the server path)
2. HTTP allowed to all networks; HTTPS recommended for public servers (HTTP exposes credentials in plaintext)
3. Only works with Jellyfin servers (not Plex, Emby, etc.)

## No Invented Fixes

See `~/.claude/skills/no-invented-fixes/` for the full protocol. Never propose fixes based on assumptions. State what you know vs. what you're guessing. If uncertain, investigate or ask.
