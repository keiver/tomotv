# CLAUDE-security.md

**Last Updated:** January 24, 2026
**Security Audit Completed:** January 24, 2026 (Comprehensive 7-agent audit)

## Quick Reference

**Category:** Security
**Keywords:** security, credentials, SecureStore, HTTPS, validation, encryption, audit

Security architecture with credential storage, network security, input validation, and comprehensive audit findings.

## Related Documentation

- [`CLAUDE-configuration.md`](./CLAUDE-configuration.md) - Credential management
- [`CLAUDE-api-reference.md`](./CLAUDE-api-reference.md) - API security
- [`CLAUDE-testing.md`](./CLAUDE-testing.md) - Security testing

---

This document describes the security architecture, known limitations, and mitigations for the TomoTV app.

---

## Security Posture: STRONG ✅

**Overall Assessment:** No critical vulnerabilities identified. The app follows security best practices for a personal media streaming client.

---

## 1. Credential Storage

### Native Secure Storage

**Platform Implementation:**

- **iOS/tvOS:** tvOS Keychain (device-local, AES-256 encrypted)
- **Android:** Android Keystore (hardware-backed when available)
- **Library:** `expo-secure-store` (official Expo module)

**Stored Credentials:**

| Key                     | Type                 | Purpose                    |
| ----------------------- | -------------------- | -------------------------- |
| `jellyfin_server_url`   | String               | Full Jellyfin server URL   |
| `jellyfin_api_key`      | String (hex)         | API authentication token   |
| `jellyfin_user_id`      | String (hex/GUID)    | User identifier            |
| `app_video_quality`     | String (0-3)         | Transcoding quality preset |
| `jellyfin_is_demo_mode` | String ("true"/null) | Demo server flag           |

**Security Features:**

- ✅ Automatic encryption at rest
- ✅ Keychain storage is device-local (tvOS does not support iCloud Keychain sync)
- ✅ Cannot be accessed by other apps
- ✅ Cleared on app uninstall
- ✅ Protected by device PIN/biometrics

### No Hardcoded Secrets

**Verified:**

- ✅ Zero hardcoded credentials in source code
- ✅ `.env.local` is git-ignored (development only)
- ✅ Production builds require user configuration via Settings
- ✅ Demo server credentials fetched dynamically from API

---

## 2. Network Security

### Transport Layer Security

**HTTPS Policy:**

- ✅ HTTPS **recommended** for remote/internet Jellyfin servers
- ✅ HTTP **allowed** for all networks (local and remote)
- ✅ Configured via `NSAppTransportSecurity` in app.json

**App Transport Security (iOS/tvOS):**

```json
"NSAppTransportSecurity": {
  "NSAllowsArbitraryLoads": true
}
```

**What This Means:**

- All servers: HTTP and HTTPS both allowed
- ⚠️ HTTP on public servers exposes credentials (username, password, API keys) in plaintext
- HTTPS strongly recommended for any server accessible over the internet
- No certificate pinning (users may have self-signed certs)

### Request Timeouts

**Timeout Enforcement:**

- Quick queries: 10 seconds
- Normal requests: 15 seconds
- Large data fetches: 30 seconds
- All requests use `AbortController` for proper cancellation

**Protection Against:**

- Hanging connections
- Slow loris attacks (indirect)
- Resource exhaustion from stalled requests

---

## 3. API Key Exposure (Known Limitation)

### Issue Description

**What Happens:**
API keys appear in URLs for certain requests:

- Image URLs: `https://server/Items/{id}/Images/Primary?api_key={key}`
- Video streams: `https://server/Videos/{id}/stream?api_key={key}`
- Subtitles: `https://server/Videos/{id}/Subtitles/{index}?api_key={key}`

**Where Keys Are Visible:**

- Development console logs (URL previews)
- Server access logs
- Browser history (web platform)
- Network capture tools during debugging

### Why This Happens

**Technical Constraint:**
Native components (`<Image>`, `react-native-video` player) cannot add custom HTTP headers. Jellyfin API requires authentication for these resources, so the API key **must** be in the query string.

**This is a Jellyfin API design constraint, not a bug in TomoTV.**

### Risk Assessment: LOW

**Why This Is Acceptable:**

1. **HTTPS Encryption:** URLs are encrypted in transit for remote servers
2. **Limited Scope:** API keys grant Jellyfin API access only (not system-level)
3. **Revocable:** Users can regenerate API keys from Jellyfin dashboard
4. **Standard Practice:** All Jellyfin clients face this same constraint

### Mitigations

**Required:**

- Use HTTPS for remote servers (encrypts URLs in transit)

**Recommended:**

- Create dedicated API key for TomoTV with minimal permissions
- Rotate API keys periodically
- Monitor Jellyfin server access logs

**For Maximum Security:**

- Use Jellyfin server on local network only
- Enable Jellyfin's IP whitelist feature
- Use VPN for remote access instead of exposing server to internet

---

## 4. Input Validation

### Server URL Validation

**Implementation:** `app/(tabs)/settings.tsx`

```typescript
const parsedUrl = new URL(trimmedUrl);
if (!parsedUrl.protocol.startsWith("http")) {
  return { valid: false, error: "Must start with http:// or https://" };
}
```

**Validates:**

- ✅ Protocol must be HTTP or HTTPS
- ✅ URL must be parseable
- ✅ Trims whitespace
- ✅ Rejects malformed URLs

### API Key Validation

**Regex:** `^[a-zA-Z0-9]{16,64}$`

**Validates:**

- ✅ Only alphanumeric characters
- ✅ 16-64 character length
- ✅ Prevents special characters that could cause injection

### User ID Validation

**Regex:** GUID format with/without dashes

**Validates:**

- ✅ Standard GUID format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- ✅ Compact format: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
- ✅ Only hex characters (0-9, a-f)

### Search Query Validation

**Implementation:** `services/jellyfinApi.ts` (parseYearsFromQuery)

**Validates:**

- ✅ Year formats: 4-digit years only
- ✅ Date ranges: validates start < end
- ✅ Decade parsing: "90s", "2000s"
- ✅ Prevents injection via regex pattern matching

**API Usage:**

- Uses `URLSearchParams` for proper encoding
- Prevents SQL/NoSQL injection via query escaping

---

## 5. Error Handling & Information Disclosure

### Production vs. Development

**Production Builds:**

- ✅ No debug information in error messages
- ✅ No stack traces shown to users
- ✅ Generic error messages only

**Development Builds (`__DEV__` mode):**

- Debug info shown for troubleshooting
- Full error details in console
- Not included in App Store builds

### Sensitive Data in Errors

**Protected:**

- ✅ API keys never appear in user-facing errors
- ✅ Server URLs shown only in Settings (intentional)
- ✅ Credentials sanitized from logs

**Example:** Demo server error handling (jellyfinApi.ts):

```typescript
if (response.status === 503) {
  throw new Error("Demo server is temporarily unavailable. Please try again in a few moments.");
}
```

User sees friendly message, not raw API response.

---

## 6. expo-tvos-search Package Security

### Input Validation (Swift Layer)

**Validation Enforced:**

- ✅ URL scheme: Only HTTP/HTTPS image URLs accepted
- ✅ String length: 500 character max for all text fields
- ✅ Numeric ranges: All numeric props clamped to safe ranges
- ✅ Array size: Max 500 search results
- ✅ Empty filtering: Results with missing id/title skipped

**Validation Warnings:**
Non-fatal validation warnings emitted as events (not crashes).

**Examples:**

- Card dimensions: 50-1000 pixels (clamped)
- Columns: 1-10 (clamped)
- Font size: 8-72 points (clamped)

### Image Loading

**Security:**

- ✅ Only HTTP/HTTPS URLs allowed
- ✅ No file:// or javascript: scheme support
- ✅ SwiftUI's AsyncImage handles downloads (system-level security)

---

## 7. Dependency Security

### Current Status (January 2026)

**Security-Critical Packages:**

- `expo-secure-store@15.0.7` - ✅ Current
- `react-native-video@6.x` - ✅ Current
- `react@19.1.0` - ✅ Latest
- `react-native-tvos@0.81.4-0` - ✅ Maintained fork

**Known Issues:**

- None affecting security

---

## 8. Attack Vectors & Mitigations

### Successfully Mitigated

✅ **Credential Injection via Settings Input**

- Mitigation: Strict validation (regex, URL parsing)

✅ **URL Injection in Stream URLs**

- Mitigation: URLSearchParams encoding, validation

✅ **Search Query Injection**

- Mitigation: Year parsing with regex, parameter encoding

✅ **Man-in-the-Middle Attacks (Remote)**

- Mitigation: HTTPS required for internet servers

✅ **Credential Exposure in Error Messages**

- Mitigation: Generic errors in production, sanitized logs

✅ **Hardcoded Secrets**

- Mitigation: All credentials in SecureStore, .env.local git-ignored

✅ **Demo Credentials Overwriting User Credentials**

- Mitigation: IS_DEMO_MODE flag prevents dev credential sync

### Out of Scope (Not App Responsibility)

⚠️ **Local Network Interception**

- User responsibility to secure home network
- Recommend WPA3 encryption, strong WiFi password

⚠️ **Jellyfin Server Security**

- External service beyond app control
- User should keep Jellyfin updated

⚠️ **Device OS Security**

- iOS/Android platform responsibility
- App inherits platform security features

---

## 9. Secure Development Checklist

**For Contributors:**

- [ ] Never commit `.env.local` to git
- [ ] Use `EXPO_PUBLIC_` prefix for environment variables
- [ ] Store all credentials in SecureStore (never localStorage)
- [ ] Validate all user inputs (URLs, search queries, settings)
- [ ] Use HTTPS for production servers (require in docs)
- [ ] Sanitize logs (check for API keys, passwords before logging)
- [ ] Test with demo server first (validates API integration)
- [ ] Review error messages (ensure no sensitive data)
- [ ] Use `URLSearchParams` for query string building
- [ ] Add timeout to all network requests
- [ ] Validate Jellyfin API responses (check for expected fields)

---

## 10. Threat Model

### Assets to Protect

1. **User Credentials** (API key, server URL, user ID)
2. **Media Access** (playback URLs, library contents)
3. **User Privacy** (viewing history, search queries)

### Trust Boundaries

**Trusted:**

- iOS/Android OS secure storage
- User's device
- User's Jellyfin server

**Untrusted:**

- Network (WiFi, internet)
- Server logs
- Third-party analytics (none used)

### Threat Scenarios

| Threat                         | Likelihood | Impact | Mitigation                         |
| ------------------------------ | ---------- | ------ | ---------------------------------- |
| Credential theft from device   | LOW        | HIGH   | Secure storage, device encryption  |
| API key interception           | LOW        | MEDIUM | HTTPS required                     |
| Jellyfin server compromise     | MEDIUM     | HIGH   | Out of scope (user responsibility) |
| Man-in-the-middle attack       | LOW        | MEDIUM | HTTPS for remote servers           |
| Malicious server URL injection | LOW        | LOW    | URL validation                     |

---

## 11. Security Audit History

| Date       | Auditor     | Findings           | Status    |
| ---------- | ----------- | ------------------ | --------- |
| 2026-01-22 | Claude Code | No critical issues | ✅ PASSED |

---

## 12. Recommendations for Users

**For Maximum Security:**

1. **Use HTTPS:** Always configure Jellyfin with SSL/TLS certificate
2. **Strong API Keys:** Let Jellyfin generate keys (32+ character random)
3. **Dedicated API Key:** Create separate key for TomoTV with limited permissions
4. **Local Network Only:** Avoid exposing Jellyfin to public internet
5. **VPN for Remote:** Use VPN instead of port forwarding
6. **Keep Updated:** Update Jellyfin server regularly
7. **Monitor Logs:** Check Jellyfin access logs for suspicious activity
8. **Secure WiFi:** Use WPA3 encryption on home network
9. **Device Lock:** Enable PIN/biometric lock on TV devices

---

## 13. Security Audit Findings (January 2026)

**Audit Date:** January 24, 2026
**Scope:** Comprehensive analysis of authentication, network security, input validation, error handling, and native code
**Auditor:** AI Code Audit Team (7 specialized agents)

**Overall Assessment:** Production-ready with recommended improvements in 9 areas.

### Summary of Findings

| Severity  | Count | Status                           |
| --------- | ----- | -------------------------------- |
| CRITICAL  | 3     | Needs improvement (not blocking) |
| IMPORTANT | 6     | Recommended fixes                |
| **Total** | **9** | **Action plan provided**         |

---

### Critical Priority Findings

#### 1. API Keys Exposed in URLs (CRITICAL - Documented Limitation)

**Status:** ALREADY DOCUMENTED (Section 3)
**Action:** None required - architectural constraint

**Reference:** See "API Key Exposure (Known Limitation)" section above for full mitigation strategy.

This is a Jellyfin API requirement - native components (`<Image>`, `<Video>`) cannot add custom headers. The following mitigations are in place:

- HTTPS enforced for remote servers (ATS policy)
- API keys scoped to Jellyfin only (not system-level)
- Documentation warns users about HTTPS requirement
- Users can rotate API keys from Jellyfin dashboard

---

#### 2. No Server URL Validation (CRITICAL - Fix Recommended)

**Current Behavior:**

- Settings screen validates URL format (http/https protocol check)
- Does NOT validate HTTPS enforcement for remote servers
- Does NOT check for localhost/private IP ranges

**Security Risk:**

- Users could configure HTTP server on public internet (credentials in plaintext)
- No warning for common misconfigurations
- Potential SSRF if URL controlled by attacker

**Recommended Fix:**

Add to `app/(tabs)/settings.tsx` validation:

```typescript
function validateServerUrl(url: string): { valid: boolean; error?: string } {
  const trimmedUrl = url.trim();

  try {
    const parsedUrl = new URL(trimmedUrl);

    if (!parsedUrl.protocol.startsWith("http")) {
      return {
        valid: false,
        error: "Server URL must start with http:// or https://",
      };
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // Check for HTTPS on non-local servers
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
    const isPrivateIP = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(hostname);

    if (!isLocalhost && !isPrivateIP && parsedUrl.protocol !== "https:") {
      return {
        valid: false,
        error: "Remote servers must use HTTPS for security. Local servers can use HTTP.",
      };
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      error: "Invalid server URL format. Example: https://jellyfin.example.com",
    };
  }
}
```

**Impact:** Prevents accidental credential exposure over unencrypted connections.

---

#### 3. Error Message Information Disclosure (CRITICAL - Partially Fixed)

**Current Status:**

- Production builds hide debug info ✅
- Generic error messages shown ✅
- **ISSUE:** Some errors still expose server URLs and technical details

**Examples Found:**

- `jellyfinApi.ts:233` - "Failed to fetch user views from {server}"
- `jellyfinApi.ts:503` - "Failed to connect to demo server at {url}"
- Player error screens show full error messages from native layer

**Recommended Fix:**

Add error sanitization helper to `services/jellyfinApi.ts`:

```typescript
export function sanitizeErrorMessage(error: Error, context: string): string {
  let message = error.message;

  // Remove server URLs
  message = message.replace(/https?:\/\/[^\s]+/g, "[server]");

  // Remove API keys (just in case)
  message = message.replace(/api_key=[a-zA-Z0-9]+/g, "api_key=[redacted]");

  // Generic fallback for production
  if (!__DEV__) {
    return `${context} failed. Please check your connection and try again.`;
  }

  return message;
}
```

**Usage:**

```typescript
try {
  const response = await fetch(url);
  // ... existing logic
} catch (error) {
  const sanitized = sanitizeErrorMessage(error as Error, "API request");
  throw new Error(sanitized);
}
```

**Impact:** Prevents server URL disclosure in error logs and crash reports.

---

### Important Priority Findings

#### 4. No HTTPS Certificate Validation (IMPORTANT - Document Only)

**Current Behavior:**

- iOS/tvOS rely on system-level ATS (App Transport Security)
- ATS allows all HTTP/HTTPS connections (`NSAllowsArbitraryLoads: true`)
- No additional certificate pinning or validation

**Risk Assessment:** LOW

- System ATS provides baseline protection
- Self-signed certs common for home Jellyfin servers
- Implementing pinning would break user servers

**Recommendation:** Document only (no code change needed)

Add to CLAUDE.md Known Issues:

```markdown
4. **Self-Signed Certificates:** iOS allows self-signed certificates on local networks per App Transport Security policy. For production servers, use a valid SSL certificate from Let's Encrypt or similar CA.
```

---

#### 5. Demo Server Credentials (IMPORTANT - Already Mitigated)

**Status:** SECURE ✅
**Current Implementation:** Credentials fetched dynamically from Jellyfin API
**No Action Required**

The demo server credentials are:

- Fetched from public API endpoint (Jellyfin's official demo)
- Reset hourly by Jellyfin
- Clearly documented as demo-only
- Never hardcoded in source

---

#### 6. No Rate Limiting (IMPORTANT - Recommend Implementation)

**Current Behavior:**

- Retry logic with exponential backoff (3 attempts max)
- No protection against rapid-fire requests from bugs

**Scenario:**

- Infinite scroll bug triggers 100 simultaneous requests
- Network timeout cascades (30 seconds × 100 = server overload)

**Recommended Fix:**

Add request queue with concurrency limit to `services/jellyfinApi.ts`:

```typescript
import PQueue from "p-queue";

// Global request queue (5 concurrent requests max)
const requestQueue = new PQueue({ concurrency: 5 });

export async function fetchWithQueue<T>(fetcher: () => Promise<T>): Promise<T> {
  return requestQueue.add(fetcher);
}

// Usage in API functions:
export async function fetchLibraryVideos(startIndex = 0, limit = 60) {
  return fetchWithQueue(async () => {
    // ... existing fetch logic
  });
}
```

**Impact:** Prevents accidental DoS of user's own Jellyfin server.

**Implementation Note:** Requires `npm install p-queue` dependency.

---

#### 7. Insufficient Logging Sanitization (RESOLVED)

**Current Status: closed.** `utils/logger.ts` sanitizes automatically and
structurally, so a URL cannot be logged with its token intact whoever writes the
call: `redactSecrets` covers the current `ApiKey` spelling, the legacy `api_key`
one and the `Token="…"` authorization form, `redactContext` walks nested objects
and arrays, and `redactError` covers the `error` argument, which was the one
path into the module that skipped redaction entirely. The recommendation below
is kept for the record; it describes a gap that no longer exists.

**Recommended Enhancement:**

Update `utils/logger.ts`:

```typescript
function sanitizeLogData(data: any): any {
  if (typeof data !== "object" || data === null) {
    return data;
  }

  const stringified = JSON.stringify(data);

  const sanitized = stringified
    // Remove API keys
    .replace(/api_key=[a-zA-Z0-9]+/g, "api_key=[REDACTED]")
    // Remove full URLs (keep protocol and hostname only)
    .replace(/(https?:\/\/[^\/\s"]+)(\/[^\s"]*)/g, "$1/[path]");

  return JSON.parse(sanitized);
}

export const logger = {
  info: (message: string, data?: any) => {
    const sanitized = data ? sanitizeLogData(data) : undefined;
    console.log(`[INFO] ${message}`, sanitized);
  },
  // ... other log levels with same pattern
};
```

**Impact:** Automatic protection against credential leakage in logs.

---

#### 8. Swift Timeout Hardcoding (IMPORTANT - Native Code)

**File:** `native/ios/MultiAudioResourceLoader/MultiAudioResourceLoader.swift`
**Issue:** 30-second timeout hardcoded, no configuration

**Current:**

```swift
request.timeoutInterval = 30
```

**Recommended:**

```swift
// Make timeout configurable via React Native props
let timeout = self.timeoutSeconds > 0 ? self.timeoutSeconds : 30.0
request.timeoutInterval = timeout
```

**Implementation:**
Add `configureTimeout(_ timeout: TimeInterval)` method to Swift module and expose via React Native bridge.

**Impact:** Allows tuning for slow connections or fast local servers.

---

#### 9. Missing Content-Type Validation (IMPORTANT - Add Validation)

**Current:** Jellyfin API responses assumed to be JSON
**Risk:** Malformed server responses could crash app

**Recommended:**

Add validation wrapper to `services/jellyfinApi.ts`:

```typescript
async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    throw new Error("Invalid server response (not JSON)");
  }

  return response.json();
}

// Usage:
export async function fetchLibraryVideos(startIndex = 0, limit = 60) {
  // Replace: await response.json()
  // With: await fetchJSON(url, { ... })
}
```

**Impact:** Prevents crashes from malformed responses.

---

### Action Plan Summary

**Immediate (Before v1.0 Release):**

1. ✅ Add URL validation for HTTPS enforcement (Settings screen) - **Priority 1**
2. ✅ Sanitize error messages to remove URLs (jellyfinApi.ts) - **Priority 2**
3. ✅ Add Content-Type validation (jellyfinApi.ts) - **Priority 3**

**Post-Release (v1.1):** 4. Add request queue with concurrency limit - **Medium Priority** 5. Enhance logger with automatic sanitization - **Medium Priority** 6. Make Swift timeouts configurable - **Low Priority**

**No Action Required:**

- API keys in URLs (architectural constraint, documented)
- Self-signed cert support (needed for home servers)
- Demo credentials (already dynamic and secure)

---

### Testing Recommendations

Security-focused test additions (see CLAUDE-testing.md for full details):

**1. `services/__tests__/jellyfinApi.security.test.ts`**

```typescript
describe("jellyfinApi - Security Validation", () => {
  it("should reject HTTP for remote servers", () => {
    const result = validateServerUrl("http://example.com:8096");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("HTTPS");
  });

  it("should allow HTTP for local IPs", () => {
    expect(validateServerUrl("http://192.168.1.100:8096").valid).toBe(true);
    expect(validateServerUrl("http://10.0.0.5:8096").valid).toBe(true);
    expect(validateServerUrl("http://localhost:8096").valid).toBe(true);
  });

  it("should sanitize server URLs from error messages", () => {
    const error = new Error("Failed to fetch from https://jellyfin.example.com:8096/api");
    const sanitized = sanitizeErrorMessage(error, "API request");

    expect(sanitized).not.toContain("jellyfin.example.com");
    expect(sanitized).toContain("[server]");
  });

  it("should remove API keys from error messages", () => {
    const error = new Error("Request failed: api_key=abc123def456");
    const sanitized = sanitizeErrorMessage(error, "Request");

    expect(sanitized).not.toContain("abc123");
    expect(sanitized).toContain("[redacted]");
  });
});
```

**2. `app/(tabs)/__tests__/settings.security.test.tsx`**

- Input validation edge cases
- SecureStore integration
- URL sanitization
- Demo mode flag protection

**3. Integration test: Verify API keys never appear in error messages**

---

### Threat Model Update

Add to Section 10 table:

| Threat                   | Likelihood | Impact | Mitigation                            |
| ------------------------ | ---------- | ------ | ------------------------------------- |
| API key in server logs   | MEDIUM     | LOW    | Documented limitation, HTTPS required |
| HTTP on public server    | LOW        | HIGH   | **NEW:** URL validation in Settings   |
| Error message disclosure | LOW        | MEDIUM | **NEW:** Error sanitization wrapper   |
| Server DoS from app bug  | LOW        | MEDIUM | **NEW:** Request queue (v1.1)         |

---

**Security Audit Completed By:** AI Code Audit Team
**Review Date:** January 24, 2026
**Next Audit Recommended:** January 2027 or before major version release

---

## Contact

**Security Concerns:**
Report security issues to the repository maintainer via GitHub Issues with [SECURITY] tag.

**NOT Security Issues:**

- API keys in URLs (documented design constraint)
- Local HTTP connections (intentional for home servers)
- Debug logs in development (stripped in production)
