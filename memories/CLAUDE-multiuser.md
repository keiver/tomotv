# Multi-User Profiles (TomoTV 3.x)

**Last Updated:** August 8, 2026

## Quick Reference

**Category:** Design of record (pre-implementation)
**Keywords:** multiuser, profiles, user switching, accounts, PIN, tvOS system users

Research + architecture for in-app multi-user profiles. Decisions locked 2026-08-08: in-app profiles only for the first release (tvOS entitlement deferred to Phase B), full server×user matrix, client-side PIN with re-lock, auto-resume last profile at boot.

## Related Documentation

- [`CLAUDE-configuration.md`](./CLAUDE-configuration.md) - current single-user SecureStore layout
- [`CLAUDE-roadmap.md`](./CLAUDE-roadmap.md) - where this lands in the release plan
- [`CLAUDE-api-reference.md`](./CLAUDE-api-reference.md) - auth/session functions this extends

---

## How the competition does it (verified 2026-08-08, primary sources)

| Client                  | Approach                                     | Detail                                                                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Swiftfin (official)     | In-app picker (merged Jan 2025, PR #1383)    | `SelectUserView` at launch; Keychain token per user (`{userID}-accessToken`); client-side PIN (`{userID}-pin`); `signOutOnBackground` default true, 1h interval                                                                            |
| Streamyfin (RN+Expo)    | In-app, full server×user matrix              | MMKV index (metadata only) + SecureStore payload `credential_<base64(serverUrl:userId)>` holding token + SHA-256 pinHash; switch validates token via `getCurrentUser()`, clears query cache; logout preserves saved credentials            |
| Plex                    | In-app only                                  | Plex Home managed users (no email/password), nav-rail avatar switcher, 4-digit PIN, per-user state server-side. No tvOS system users (top open feature request)                                                                            |
| Emby                    | In-app only                                  | Avatar switcher, server-configured 4-digit PIN. Documented complaint: no idle re-lock, child protection defeated while app stays resident                                                                                                  |
| Infuse 8.2 (Jul 2025)   | tvOS system users -- only 3rd party doing it | Per-profile everything via runs-as-current-user, but each tvOS profile re-sets-up sources from scratch, launch-window profile data leaks reported, Top Shelf doesn't update per user (open Apple bug), Firecore recommends disabling shelf |
| Netflix / Disney+ / Max | In-app avatar grid                           | Server-side profiles, zero tvOS system-user integration                                                                                                                                                                                    |
| Apple TV app            | System users                                 | Apple's own showcase; per-user Up Next/watchlist                                                                                                                                                                                           |

Consensus: the in-app switcher with saved per-user tokens is the proven pattern. Exactly one third-party media app bet on the OS entitlement and shipped with bugs.

## Platform facts (tvOS)

- `TVUserManager` profile-mapping APIs (tvOS 13) are deprecated since tvOS 16.
- Modern path: `com.apple.developer.user-management: [runs-as-current-user]` entitlement (tvOS 14+). OS terminates and relaunches the app as the new user; UserDefaults/filesystem/Keychain become per-user automatically. Paid dev account required, no special approval.
- tvOS 16+: `kSecUseUserIndependentKeychain` marks Keychain items shared across system users. Apple's recommended media pattern: shared credentials in user-independent Keychain + per-user profile preference in per-user UserDefaults. **expo-secure-store cannot set this flag** -- needs native work.
- Open platform bugs: Top Shelf extensions do not reliably update per system user even with the entitlement (Apple forum thread 668938, unanswered); reported local Core Data store reset on switch (thread 742492); background URLSession behavior on switch undocumented.
- tvOS 26 added an OS wake-time profile picker; tvOS 26.2 added account-free profiles (no Apple ID). Demand for system-user support will grow (Swiftfin issue #258 open since 2021).

## Jellyfin server constraints

- **No sub-profiles.** Users are the only entity. Kid profiles = users with restrictive `UserPolicy` (`MaxParentalRating`, `EnabledFolders`, `BlockedTags`, access schedules). Server-side content filtering comes free per profile.
- **One access token per DeviceId**: a different user authenticating with the same `DeviceId` revokes the prior token (source: nielsvanvelzen auth gist, Jellyfin core dev). Multi-account requires a distinct DeviceId per profile. VERIFY against a live Jellyfin 12 server early in implementation.
- Tokens never auto-expire; revoked only by logout or admin. Long-lived per-profile tokens are safe.
- `GET /Users/Public` (unauthenticated): visible users with `Name`, `Id`, `HasPassword`, `PrimaryImageTag` -- feeds the avatar picker. `IsHidden` users excluded. `HasPassword: false` users can authenticate with empty `Pw`.

## Shipped early (2026-08-19)

The account store landed ahead of 3.2.0: `services/jellyfin/accounts.ts`
(`jellyfin_accounts` index + per-account token keys + per-account deviceId),
`saveAuthResult` upserts accounts, `activateAccount` validates via `/Users/Me`
and fills the active slot, and the server list offers "Continue as <user>" on
saved cards (`hooks/useSelectSavedServer.ts`). Sign Out keeps saved accounts.
Settings' connected card now has a gold "Switch Server" CTA pushing
`app/connect/servers.tsx` (server list + Sign Out row) as a real route.
Still 3.2.0 scope: PIN, avatar profile switcher, boot auto-resume changes.

## Architecture (design of record)

**Core insight: existing SecureStore keys become the "active session slot".** `cachedConfig`, all synchronous URL builders, `clearContentCaches()`, `notifyAuthChange()`, and the Top Shelf extension (which reads `jellyfin_server_url/api_key/user_id/device_id` from the Keychain group directly) keep working untouched. The shelf follows the active profile for free. Multi-user is a layer above:

1. **Account store** -- new `services/jellyfin/accounts.ts`:
   - SecureStore index `jellyfin_accounts`: array of `{ serverId, serverUrl, serverName, userId, userName, primaryImageTag, authMethod, deviceId, lastUsedAt, pinHash? }`.
   - Token stored per-account at its own SecureStore key (Streamyfin pattern; index holds metadata only).
   - Per-account `deviceId` derived from base device ID + userId (one-token-per-device rule).
   - `saveAuthResult()` (`services/jellyfin/auth.ts:216`) additionally upserts the account. Demo mode stays transient, never saved.
2. **Switching**: optional PIN gate -> write active-slot keys -> `refreshConfig()` -> `clearContentCaches()` -> `notifyAuthChange()` -> validate token via `getCurrentUser()`; on 401 drop that credential and fall back to login.
3. **Sign-out semantics**: sign-out keeps the saved profile (fast switch-back). Separate explicit "remove profile" deletes token + metadata.
4. **PIN**: 4-digit pad, SHA-256 hash via expo-crypto, client-side only (server never sees it). Re-lock on cold launch into a protected profile and after a background timeout (~1h, Swiftfin default; fixes the documented Emby complaint).
5. **UX**: auto-resume last profile at boot, no forced picker (Apple WWDC guidance; tvOS 26 wake-picker friction complaints confirm). Avatar grid using `/Users/Public` `PrimaryImageTag`; switcher entry in Settings connected section; "add user" reuses the existing Quick Connect / password flow. Saved-servers cards (`jellyfin_saved_servers`, `services/jellyfin/connection.ts:245`) gain per-server account lists (full matrix).
6. **Cache hygiene**: request caches are already `userId`-keyed; the global caches (`libraryManager`, `folderContentsCache`, `favoritesCache`, `playedCache`, `nextUp` dismissals) are handled by the existing `clearContentCaches()` call in the switch path. No re-keying needed in v1.
7. **Stays global**: `app_video_quality` (device/network capability, not identity), base `jellyfin_device_id`.

## Phase B (deferred): tvOS system-user mapping

`runs-as-current-user` + native `kSecUseUserIndependentKeychain` for the shared account store, per-tvOS-user "last profile" in per-user UserDefaults. Deferred because: Top Shelf per-user bug unresolved at Apple, entitlement forces relaunch-on-switch semantics, unproven with React Native, and expo-secure-store needs a native path for the shared-keychain flag. Phase A's account store is the prerequisite either way.

## Implementation-time verification items

1. Confirm one-token-per-DeviceId revocation against a live Jellyfin 12 server (login user B with user A's DeviceId, check A's token).
2. Confirm `/Users/Public` behavior with hidden users and passwordless users.
3. Device-test PIN re-lock timing (cold launch + background interval).
4. Confirm Top Shelf follows a profile switch on the next OS refresh (it reads the active-slot keys, so it should).

## Sources

- Swiftfin store/auth: github.com/jellyfin/Swiftfin (`Shared/SwiftfinStore/*`, `Shared/Views/SelectUserView/*`); issue #258 (tvOS user mapping), PR #1383 (select-user + PIN)
- Streamyfin: github.com/streamyfin/streamyfin (`utils/secureCredentials.ts`, `providers/JellyfinProvider.tsx`, `components/login/TVLogin.tsx`)
- Jellyfin auth: gist.github.com/nielsvanvelzen/ea047d9028f676185832e51ffaf12a6f; jellyfin.org/docs/general/server/quick-connect; typescript-sdk.jellyfin.org (UserPolicy, AuthenticationResult)
- Apple: WWDC19 s211, WWDC20 s10645, WWDC22 s110384; developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.user-management; forums thread 668938 (Top Shelf), 742492 (Core Data), 723980 (free-account restriction)
- Infuse: support.firecore.com "Multiple User Profiles"; community.firecore.com threads 57801, 36447
- Plex: support.plex.tv "Fast User Switching", "Managed Accounts"; forums.plex.tv/t/932443
- Emby: emby.media/community topics 123757, 56680
