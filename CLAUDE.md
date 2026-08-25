# CLAUDE.md

## THE ULTIMATE RULE: NO PREDICTIONS. EVER.

Never act on, state, or commit anything derived from a prediction. Every claim
gets CONFIRMED first: read the code path, run the probe, research the source.
If a claim involves runtime state (a measurement, a cache, a server), check the
actual state — never assume what it holds. An expected outcome stated to the
user is a claim; if it wasn't verified against code, data, or a live check, it
does not get said. "It should" is banned; "measured/read/probed: it does" is
the only acceptable form.

A plan is a claim. Never present a step whose mechanism is unconfirmed, and
never present refusing to plan it as the alternative. Go confirm it: probe the
server, read the log, run the pipeline. Never dress a design decision up as an
open question in a table of findings.

**TomoTV** is a Jellyfin video streaming app built with React Native TVOS and Expo, targeting Apple TV (tvOS) and iOS. Playback runs through an on-device engine (native/ios/LocalRemuxer + an owned FFmpeg build): H.264/HEVC stream-copy from any container, on-device transcode for the rest, Dolby passthrough, multi-audio switching, and image subtitles drawn over the native player. The server transcodes only true edge cases.

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
- "engine" / "remux" / "codec" / "transcode" / "deinterlace" / "swscale" -> `memories/CLAUDE-playback-engine.md`
- "slipstream" / "adaptive" / "ABR" / "variants" / "gateway" -> `memories/CLAUDE-slipstream.md`

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
npm run logs                      # Stream native NSLog/os_log from the booted simulator (second pane beside npm start)
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

### Comments: 1-2 lines, present tense

Say the constraint or the non-obvious "why", then stop. Cut anything a reader can get from the code itself. Hard ceilings: a docblock is 3 lines, an inline block is 2, and comments stay under 15% of the lines a diff adds. Over the ceiling, delete before rewriting.

Never write:

- **Temporal framing** -- "now", "used to", "no longer", "previously", "the old X", "this replaced Y". There is no "then" for a future reader. When behaviour changes, DELETE the comment describing the old behaviour instead of narrating the change.
- **Justification blocks** defending a choice or explaining what could not be done. That belongs in the commit message.
- **Essays in data files.** A `comment` field in a JSON manifest or fixture is still a comment and takes the same limit.
- **Restated call graphs.** "Six readers depend on this memory and none probe for themselves", "also runs on audio switch, seek recovery and retries". A caller list is wrong the day someone adds a caller, and a reviewer who believes it stops grepping.

This is not style. Long comments go stale, and stale comments get acted on: a header claiming a library could not be linked survived after it was linked, and a probe comment asserting a code path that no longer existed produced a false regression report.

### Reviewing: comments are what is under review, never the evidence

Open the call path before repeating any claim a comment makes, including comments inside the diff being reviewed and claims in its commit message. Volume is the trap: a dense comment layer reads as understanding and displaces the reading of the code. On `fix/link-measurement-triggers` a 36%-comment diff produced a review that graded prose, forwarded the code's own comment about which paths re-enter a function as a finding, and asserted an OS fact from memory. Every finding names a file:line that was actually opened, or it does not ship.

## Known Issues

1. The on-device engine (native/ios/LocalRemuxer) plays H.264/HEVC in any container by stream copy, and everything else the linked FFmpeg decodes by VideoToolbox transcode — any bit depth, interlaced or not, audio-only files included. Subtitles send nothing to the server: text tracks ship as selectable HLS renditions, image tracks (PGS, DVD/VobSub, DVB, XSUB) are decoded on device to timed bitmaps the app draws over the native player. Server-side transcoding remains only for exotic codecs above the per-device pixel budget (`TRANSCODE_MAX_PIXELS`). We build FFmpeg ourselves (`scripts/ffmpeg/build.sh`, published by `.github/workflows/build-ffmpeg.yml`, fetched by `scripts/fetch-ffmpeg.js`) with every native decoder enabled — 519 of them, versus the 60 MPVKit's prebuilt allowlist left on — so DivX 3, Theora, DV, Cinepak and VVC all decode on device. `npm run probe:codecs` prints what the build actually registers. **Decision tree, allowlists and rationale: `memories/CLAUDE-playback-engine.md`**
2. HTTP allowed to all networks; HTTPS recommended for public servers (HTTP exposes credentials in plaintext)
3. Only works with Jellyfin servers (not Plex, Emby, etc.)

## No Invented Fixes

See `~/.claude/skills/no-invented-fixes/` for the full protocol. Never propose fixes based on assumptions. State what you know vs. what you're guessing. If uncertain, investigate or ask.
