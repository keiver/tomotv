# Configuration Management

**Last Updated:** January 24, 2026

## Quick Reference

**Category:** Implementation
**Keywords:** configuration, credentials, SecureStore, demo mode, settings

Runtime configuration backed by SecureStore, with demo mode support. Users connect from the Settings screen (server IP + Quick Connect code, or username/password); there is no build-time credential mechanism.

## Related Documentation

- [`CLAUDE-api-reference.md`](./CLAUDE-api-reference.md) - Configuration API methods
- [`CLAUDE-security.md`](./CLAUDE-security.md) - Credential security
- [`CLAUDE-development.md`](./CLAUDE-development.md) - Development environment setup

---

## Configuration Source

1. `getConfig()` reads server URL, API key, and user ID from SecureStore
2. Returns empty strings when nothing is configured (no server connected yet)
3. Users connect via the Settings screen; credentials are stored in native secure storage

### Demo Mode (Testing without setup)

1. One-tap connection to Jellyfin's official demo server (`https://demo.jellyfin.org/stable`)
2. Credentials fetched dynamically via API (demo server resets hourly)
3. Stores demo credentials in SecureStore with `IS_DEMO_MODE` flag
4. Users can disconnect from demo and configure their own server anytime
5. Perfect for App Store reviewers or first-time users

### Demo Server Advanced Features

The `connectToDemoServer()` function supports cache management:

```typescript
connectToDemoServer(clearCaches: boolean = true)
```

**Parameters:**

- `clearCaches` (default: `true`): Controls cache behavior
  - `true`: Full cache clear (use when initially connecting to demo server)
  - `false`: Preserve UI state (use when refreshing expired credentials mid-session, e.g., during video playback)

## SecureStore Keys

| Key                                   | Purpose                                                      | Type            |
| ------------------------------------- | ------------------------------------------------------------ | --------------- |
| `jellyfin_server_url`                 | Active session: server URL                                   | string          |
| `jellyfin_api_key`                    | Active session: access token                                 | string (hex)    |
| `jellyfin_user_id`                    | Active session: user GUID                                    | string (hex)    |
| `jellyfin_user_name`                  | Active session: display name                                 | string          |
| `jellyfin_auth_method`                | Active session: quickconnect \| password \| apikey           | string          |
| `jellyfin_server_name`                | Active session: server display name                          | string          |
| `jellyfin_server_id`                  | Active session: server system Id (LAN-change recovery)       | string (hex)    |
| `jellyfin_device_id`                  | Active session's DeviceId; rewritten on login/account switch | string (uuid)   |
| `jellyfin_saved_servers`              | Saved server cards (no credentials)                          | JSON array      |
| `jellyfin_accounts`                   | Saved accounts index (metadata only, no tokens)              | JSON array      |
| `jellyfin_account_token_<srv>_<user>` | One saved account's access token                             | string (hex)    |
| `app_video_quality`                   | Transcoding quality preset                                   | string (number) |
| `jellyfin_is_demo_mode`               | Demo server connection flag                                  | "true" \| null  |

**Note:** All keys are stored in device Keychain via expo-secure-store. The first
eight are the "active session slot" everything downstream reads; `services/jellyfin/accounts.ts`
fills the slot from a saved account (`activateAccount`) or saves the slot's login
(`saveAuthResult` → `upsertAccount`). Sign Out clears only the slot — saved accounts
survive for one-tap reconnect; removing a saved server deletes its accounts and tokens.
Each account carries its own `deviceId` (Jellyfin keeps one token per DeviceId per server).

## Configuration Initialization Pattern

`getConfig()` reads SecureStore and updates an in-memory `cachedConfig` for the synchronous URL builders. Components that need guaranteed initialized config can await `waitForConfig()`, which resolves once `getConfig()` has run at least once.

## Configuration Migration

**Old Format (v1.x):**

- Separate keys: `JELLYFIN_SERVER_IP`, `JELLYFIN_SERVER_PORT`, `JELLYFIN_SERVER_PROTOCOL`
- Three discrete values combined into URL

**New Format (v2.x+):**

- Single key: `jellyfin_server_url` (full URL string)
- Simpler validation and usage

**Auto-Migration:**
On first load, `migrateOldConfigFormat()` in `services/jellyfinApi.ts`:

1. Checks for old keys in SecureStore
2. Combines into full URL format
3. Writes to new `jellyfin_server_url` key
4. Deletes old keys
5. One-time operation, no user intervention required

## Security Considerations

- No hardcoded credentials in source code
- ATS (App Transport Security) allows HTTP for all networks (HTTPS recommended for internet servers)
- Credentials stored in device Keychain

### API Key in URLs (Jellyfin Limitation)

The API key must be included in query parameters for certain URLs consumed by native components:

- **Image URLs:** Poster/thumbnail URLs passed to `<Image>` components
- **Video URLs:** Stream URLs passed to `react-native-video` player
- **Download URLs:** Direct file download URLs

This is a Jellyfin API requirement - these native components cannot add custom headers to requests. The API key will appear in:

- Server access logs
- Browser history (web platform)
- Network capture tools during debugging

**Mitigations:**

- Use HTTPS for remote servers (encrypts URLs in transit)
- API keys have limited scope (Jellyfin API access only, not system-level)
- Users can regenerate API keys from Jellyfin dashboard if compromised
- For maximum security, use a dedicated API key for this app with minimal permissions

## Settings Screen Implementation

The Settings screen (`app/(tabs)/settings.tsx`) uses specialized patterns for credential management and UI state synchronization.

### Auto-Reload Pattern

The settings screen uses `useFocusEffect` instead of `useEffect` to reload credentials whenever the screen comes into focus:

```typescript
useFocusEffect(
  useCallback(() => {
    loadSettings();
  }, []),
);
```

This ensures:

- Demo server credentials are visible after connecting from error screens
- Settings always reflect current SecureStore state
- Multi-screen workflows work seamlessly

### Form State Management

Uses refs (`currentServerUrl.current`) alongside state to maintain sync between input fields and validation logic without causing unnecessary re-renders.

### Demo Mode UI

Demo server connection is NOT available from Settings screen (removed in commit 740d791). Demo mode is only accessible via:

- "Try Demo Server" button on Library error screen
- Programmatic `connectToDemoServer()` calls
