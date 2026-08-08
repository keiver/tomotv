# TomoTV Development Setup

## Quick Reference

**Category:** Deployment
**Keywords:** development, setup, configuration, connect

Run the app and connect to a Jellyfin server from the in-app Settings screen — same flow in development and production.

## Related Documentation

- [`CLAUDE-configuration.md`](./CLAUDE-configuration.md) - Development configuration
- [`CLAUDE-patterns.md`](./CLAUDE-patterns.md) - Development workflow
- [`CLAUDE-apple-store-metadata.md`](./CLAUDE-apple-store-metadata.md) - Submission metadata and review notes

---

## Local Development Configuration

### Quick Start

```bash
npm install
npm start
```

Then connect to your Jellyfin server from the in-app **Settings** screen — exactly the
same flow production users follow:

1. Open the app and go to the **Settings** tab
2. Enter your server IP/hostname (e.g. `192.168.1.171`) or full URL — the app
   auto-discovers protocol and port
3. Authorize with a **Quick Connect** code (or username/password)
4. On success the app drops you on the Library root; credentials persist in the device
   Keychain (SecureStore) across restarts

There is no `.env.local` / build-time credential mechanism — connecting through Settings
is the only path, on simulator and device alike.

---

## Getting a Quick Connect Code

1. Sign in to the Jellyfin web interface as the user you want to connect
2. Open **user profile → Quick Connect** and note the 6-digit code shown in the app's
   Quick Connect screen, then authorize it
3. Alternatively use username/password directly in the Settings screen

---

## Troubleshooting

### App shows "not configured"

**Check:**

1. You completed the Settings connect flow (server IP + Quick Connect / password)
2. The server is reachable from the device/simulator on the network
3. Restart Metro bundler if needed: `npm start -- --clear`

### "Network request timed out" on iOS Simulator

**Solution:** Ensure ATS (App Transport Security) is configured in `app.json`:

```bash
npx expo prebuild --clean
npm run ios
```

See: `app.json` → `ios.infoPlist.NSAppTransportSecurity`

### Can't connect to Jellyfin server

**Check:**

1. Jellyfin server is running
2. IP address is correct (try `http://localhost:8096` if on same machine)
3. Firewall allows port 8096
4. iOS ATS allows HTTP connections (see above)

---

## App Store Submission

Before submitting to App Store, verify:

1. **No hardcoded credentials in source code** ✅
2. **First-run experience works** (fresh install shows the connect screen) ✅
3. **Settings screen allows user configuration** (server IP + Quick Connect / password) ✅

The app is designed to be **safe for App Store distribution** with a single runtime
connect flow shared by developers and end users.
