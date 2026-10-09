# Repository Guidelines

## Project Structure & Module Organization

Tomotv is an Expo Router app for iOS, tvOS and Mac Catalyst. Generated Apple projects live in `ios/`, `macos/` and `tvos/`; native sources live in `native/` and `packages/*/ios`, with project configuration in `plugins/` and `scripts/`. Routed screens sit in `app/`. Shared UI primitives belong in `components/`, hooks in `hooks/`, and global state in `contexts/`. Playback and catalog clients live in `services/`; helpers and types stay in `utils/` and `types/`. Tests mirror their targets (e.g., `services/__tests__/libraryManager.test.ts`). Media assets live in `assets/`, and docs in `docs/`.

## Build, Test, and Development Commands

Install dependencies with `npm install`. `npm run clear` prepares iOS, Mac and tvOS in that order, opens `TomoTV.xcworkspace`, and starts Metro. The schemes are `TomoTV-iOS`, `TomoTV-macOS` and `TomoTV-tvOS`; Mac uses the **My Mac (Mac Catalyst)** destination. `npm run clearmac` prepares Mac alone. `npm run prebuild:all` and `npm run prebuild:mac` generate projects without starting Xcode or Metro. `npm run start` launches Metro for existing projects. `npm run archive -- <next-build>` archives all three platforms with one increasing build number; see `docs/RELEASING.md` for signing and manual Mac captures. Run `npm run lint` for ESLint and Prettier checks (`npm run lint:fix` applies fixes). Execute `npm run test`, `npm run test:watch`, or `npm run test:coverage` for app logic, and `npm run test:release` for project and release scripts.

## Coding Style & Naming Conventions

The codebase is TypeScript-first with strict ESLint and Prettier configs—use 2-space indentation, semicolons, and single quotes inside TS/TSX. Components and hooks follow `PascalCase` filenames (`VideoShelf.tsx`, `usePlayback.ts`). Utilities and services use `camelCase`. Keep styles beside components, prefer `StyleSheet.create`, and avoid editing generated outputs inside `android/`, `ios/`, `macos/` or `tvos/` unless performing a native patch.

## Testing Guidelines

Jest (via `jest-expo`) drives the suite. Place specs in local `__tests__` folders and suffix files with `.test.ts(x)` or `.threading.test.ts(x)` for concurrency helpers. Mock network I/O within services, lean on `react-test-renderer` harnesses for hooks/contexts (RTL is not wired up here), and aim for ≥80% statement coverage when running `npm run test:coverage`. Every bugfix should ship with a regression test.

## Commit & Pull Request Guidelines

Follow the existing `type: concise summary` format (e.g., `fix: clear player queue`) and keep commits scope-limited. Reference issue IDs when applicable and bundle related asset/config updates with the code. Pull requests should include: a short purpose statement, testing steps (commands + expected outcome), screenshots or recordings for UI changes, and any follow-up tasks. Request reviews from platform owners when touching `services/` or device-specific modules.

## Security & Configuration Tips

Never commit secrets; rely on secure store APIs and Expo config values. Connect to a Jellyfin server at runtime from the in-app Settings screen (server IP + Quick Connect code, or username/password); credentials are persisted in SecureStore. For TV builds, set `EXPO_TV=1` locally and verify the Apple/Android TV asset sets (`TVOS_ICONS.md`, `Images.xcassets/`) stay in sync with feature work.
