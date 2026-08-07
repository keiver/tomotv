# Testing Strategy - TomoTV

**Last Updated:** August 7, 2026 (added Automated Playback Regression Suite; test videos merged into TNN library)
**Current Coverage:** 51.1% overall
**Test Framework:** Jest 29.7.0 with react-test-renderer
**Target Coverage:** 80% (industry standard for production apps)

## Quick Reference

**Category:** Testing
**Keywords:** testing, test, Jest, coverage, unit tests, integration tests, mocking, threading, compliance tests, anti-patterns

Comprehensive testing strategy with current coverage analysis, test patterns, and roadmap to 80% coverage.

## Related Documentation

- [`CLAUDE-components.md`](./CLAUDE-components.md) - Component testing
- [`CLAUDE-patterns.md`](./CLAUDE-patterns.md) - Test patterns
- [`CLAUDE-security.md`](./CLAUDE-security.md) - Security testing requirements

---

## Executive Summary

TomoTV has moderate test coverage (51.1%) with significant gaps in critical areas. This document provides a comprehensive strategy to increase coverage to 80% while focusing on security-critical code, core functionality, and user workflows.

**Key Findings:**

- ✅ Services: 67.63% (good)
- ✅ Utils: 91.02% (excellent)
- ⚠️ Contexts: ~60% (acceptable, needs improvement)
- ❌ Hooks: 8.11% (critical gap)
- ❌ Components: 0% (all untested)

---

## Coverage Analysis (As of January 24, 2026)

### Current State

| Category       | Coverage | Files Tested | Status                |
| -------------- | -------- | ------------ | --------------------- |
| **Overall**    | 51.1%    | 14 of 31     | ⚠️ Below target (80%) |
| **Services**   | 67.63%   | 4 of 5       | ✅ Good               |
| **Contexts**   | ~60%     | 3 of 3       | ✅ Acceptable         |
| **Hooks**      | 8.11%    | 5 of 5       | ❌ Critical gap       |
| **Components** | 0%       | 0 of 6       | ❌ Critical gap       |
| **Utils**      | 91.02%   | 2 of 2       | ✅ Excellent          |
| **Screens**    | ~10%     | 3 of 5       | ❌ Critical gap       |

### Coverage by File (Detailed)

**Well-Tested (80%+):**

- `utils/logger.ts` - 90.47%
- `utils/retry.ts` - 91.66%
- `services/libraryManager.ts` - 93.51%

**Moderately Tested (50-79%):**

- `services/jellyfinApi.ts` - 56.7%
- `services/multiAudioLoader.ts` - 49.25%
- `contexts/LibraryContext.tsx` - ~60% (estimated)
- `contexts/LoadingContext.tsx` - ~55% (estimated)

**Poorly Tested (< 50%):**

- `hooks/useVideoPlayback.ts` - **8.11%** (only reducer tested)
- `hooks/useColorScheme.ts` - **0%**
- `hooks/useAppStateRefresh.ts` - **0%**

**Untested (0%):**

- `components/video-grid-item.tsx` - 0%
- `components/folder-grid-item.tsx` - 0%
- `components/library-grid.tsx` - 0%
- `components/FocusableButton.tsx` - 0%
- `hooks/useFolderContents.ts` - 0%
- `components/error-boundary.tsx` - 0% (security-critical!)
- `app/(tabs)/(library)/index.tsx` + `[folderId].tsx` - 0% (library screens)
- `app/(tabs)/settings.tsx` - 0% (security-critical!)
- `app/(tabs)/help.tsx` - 0%
- `app/player.tsx` - 0% (only threading tests exist)

---

## Critical Gaps Identified

### Gap 1: useVideoPlayback Hook (8% coverage)

**Why Critical:**

- Core app functionality (video playback)
- Complex state machine (7 states, 15+ actions)
- Race condition prevention logic
- Integration with native player
- Security-sensitive (demo credential refresh)

**Current Tests:**

- ✅ `useVideoPlayback.reducer.test.ts` - Tests reducer only (state transitions)
- ✅ `useVideoPlayback.threading.test.ts` - Tests threading patterns only
- ✅ `useVideoPlayback.audioMapping.test.ts` - Tests audio track mapping
- ✅ `useVideoPlayback.audioSwitching.test.ts` - Tests multi-audio switching

**Missing Tests (92% of hook untested):**

- Full playback flow integration (IDLE → PLAYING)
- Codec detection integration with jellyfinApi
- Stream URL generation integration
- Auto-retry behavior (PLAYBACK errors only)
- Cleanup on unmount (memory leak check)
- Multi-audio decision logic integration
- Subtitle handling integration
- Demo mode credential refresh (401 error handling)

**Risk Level:** CRITICAL - Video playback is core functionality

---

### Gap 2: Components (0% coverage)

**Why Critical:**

- Most-rendered components (VideoGridItem appears 60+ times on screen)
- Performance-critical optimizations (React.memo, lazy metadata)
- Security-critical (ErrorBoundary prevents credential leakage)

**Untested Components:**

**VideoGridItem (345 lines)**

- React.memo with custom comparison
- Lazy metadata computation (only when focused)
- Conditional BlurView rendering
- Platform-specific sizing (TV vs. phone)
- Image priority logic (first 10 items)

**FolderGridItem (similar patterns to VideoGridItem)**

**ErrorBoundary (security-critical)**

- Prevents rendering sensitive info in errors
- Recovery without exposing credentials
- Debug info only shown in `__DEV__`

**FocusableButton (reusable UI component)**

- 5 variants (primary, secondary, destructive, debug, retry)
- TV focus enhancements
- Accessibility props

**Risk Level:** HIGH - Performance and security implications

---

### Gap 3: Security Code (0% coverage)

**Why Critical:**

- Security bugs could expose credentials
- Input validation failures could crash app
- No safety net for security-critical paths

**Untested Security Functions:**

- URL validation in Settings screen (validateServerUrl)
- Error sanitization (if implemented per security audit)
- Input validation regex (API key, User ID)
- Content-Type validation (if implemented)

**Risk Level:** CRITICAL - Security-critical code must be tested

---

### Gap 4: Screens (< 10% coverage)

**Why Important:**

- User workflows untested
- Integration points between components
- Navigation flows

**Untested Screens:**

- `app/(tabs)/(library)/index.tsx` + `[folderId].tsx` (library screens) + `components/library-grid.tsx`
- `app/(tabs)/settings.tsx` (Settings - 683 lines, security-critical)
- `app/(tabs)/help.tsx` (Help screen)
- `app/player.tsx` (Player screen - 395 lines, partial threading tests only)

**Risk Level:** MEDIUM - Integration tests catch workflow bugs

---

## Priority Test Additions

### Phase 1: Critical Coverage (Target: 60% overall)

**Estimated Timeline:** 1-2 weeks
**Priority:** CRITICAL (block v1.0 release)

#### Test 1: `hooks/__tests__/useVideoPlayback.comprehensive.test.ts`

**Purpose:** Test full playback integration flow

**Test Coverage:**

```typescript
describe("useVideoPlayback - State Machine Integration", () => {
  it("should transition IDLE → FETCHING_METADATA on playVideo", async () => {
    const { result } = renderHook(() => useVideoPlayback());

    await act(async () => {
      result.current.playVideo("video-123");
    });

    expect(result.current.state.type).toBe("FETCHING_METADATA");
  });

  it("should complete full flow: IDLE → PLAYING", async () => {
    mockFetchVideoDetails.mockResolvedValue(mockH264Video);

    const { result } = renderHook(() => useVideoPlayback());

    await act(async () => {
      result.current.playVideo("video-123");
    });

    // Trigger onLoad callback
    await act(async () => {
      result.current.videoCallbacks.onLoad();
    });

    expect(result.current.state.type).toBe("READY");

    // Trigger onProgress callback (first frame)
    await act(async () => {
      result.current.videoCallbacks.onProgress({ currentTime: 0.1 });
    });

    expect(result.current.state.type).toBe("PLAYING");
  });

  it("should auto-retry with transcoding on PLAYBACK error", async () => {
    mockFetchVideoDetails.mockResolvedValue(mockH264Video);

    const { result } = renderHook(() => useVideoPlayback());

    await act(async () => {
      result.current.playVideo("video-123");
    });

    // Trigger playback error
    await act(async () => {
      result.current.videoCallbacks.onError({ type: "PLAYBACK", message: "Failed" });
    });

    // Should auto-retry with transcoding
    expect(mockGetTranscodingStreamUrl).toHaveBeenCalled();
  });

  it("should NOT auto-retry on METADATA_FETCH error", async () => {
    mockFetchVideoDetails.mockRejectedValue(new Error("Not found"));

    const { result } = renderHook(() => useVideoPlayback());

    await act(async () => {
      result.current.playVideo("video-123");
    });

    expect(result.current.state.type).toBe("ERROR");
    expect(result.current.state.canRetryWithTranscode).toBe(false);
  });

  it("should cleanup properly on unmount during FETCHING state", async () => {
    const { result, unmount } = renderHook(() => useVideoPlayback());

    await act(async () => {
      result.current.playVideo("video-123");
    });

    // Unmount before fetch completes
    unmount();

    // Fetch completes after unmount
    await mockFetchVideoDetails.mock.results[0].value;

    // Should not crash (isMountedRef check prevents state update)
  });
});

describe("useVideoPlayback - Race Conditions", () => {
  it("should handle rapid play/stop/play sequence", async () => {
    const { result } = renderHook(() => useVideoPlayback());

    await act(async () => {
      result.current.playVideo("video-1");
      result.current.playVideo("video-2"); // Before first completes
    });

    // Only latest video should be playing
    expect(result.current.currentVideoId).toBe("video-2");
  });

  it("should discard stale metadata when videoId changes", async () => {
    const { result } = renderHook(() => useVideoPlayback());

    // Start loading video-1
    act(() => {
      result.current.playVideo("video-1");
    });

    // Immediately start video-2
    await act(async () => {
      result.current.playVideo("video-2");
    });

    // video-1 metadata arrives (stale)
    // Should be discarded due to requestId mismatch
    expect(result.current.currentVideoId).toBe("video-2");
  });
});

describe("useVideoPlayback - Demo Mode Credential Refresh", () => {
  it("should refresh demo credentials on 401 error", async () => {
    mockIsDemoMode.mockReturnValue(true);
    mockFetchVideoDetails.mockResolvedValue(mockH264Video);

    const { result } = renderHook(() => useVideoPlayback());

    await act(async () => {
      result.current.playVideo("video-123");
    });

    // Trigger 401 error
    await act(async () => {
      result.current.videoCallbacks.onError({ type: "UNAUTHORIZED", message: "401" });
    });

    expect(mockConnectToDemoServer).toHaveBeenCalledWith(false); // Preserve UI state
    expect(mockRefreshConfig).toHaveBeenCalled();
  });

  it("should NOT retry credential refresh twice", async () => {
    mockIsDemoMode.mockReturnValue(true);

    const { result } = renderHook(() => useVideoPlayback());

    await act(async () => {
      result.current.playVideo("video-123");
    });

    // First 401 error
    await act(async () => {
      result.current.videoCallbacks.onError({ type: "UNAUTHORIZED", message: "401" });
    });

    // Second 401 error
    await act(async () => {
      result.current.videoCallbacks.onError({ type: "UNAUTHORIZED", message: "401" });
    });

    // Should only refresh once (hasTriedCredentialRefresh flag)
    expect(mockConnectToDemoServer).toHaveBeenCalledTimes(1);
  });
});
```

**Expected Coverage Increase:** +15% overall

**Files Created:** 1 file, ~300 lines

---

#### Test 2: `components/__tests__/VideoGridItem.test.tsx`

**Purpose:** Test performance optimizations and rendering

**Test Coverage:**

```typescript
import { render, fireEvent } from '@testing-library/react-native';
import VideoGridItem from '../video-grid-item';
import { createMockVideo } from '../../test-utils/mockData';

describe('VideoGridItem - Performance Optimizations', () => {
  it('should NOT compute metadata when not focused', () => {
    const mockVideo = createMockVideo();
    const { queryByText } = render(
      <VideoGridItem video={mockVideo} onPress={jest.fn()} index={0} />
    );

    // Duration metadata should not be rendered
    expect(queryByText(/\d+ min/)).toBeNull();
  });

  it('should compute metadata when focused', () => {
    const mockVideo = createMockVideo({ RunTimeTicks: 7200000000 }); // 120 min
    const { getByText, getByTestId } = render(
      <VideoGridItem video={mockVideo} onPress={jest.fn()} index={0} />
    );

    // Simulate focus
    fireEvent(getByTestId('video-card'), 'focus');

    // Metadata should now be rendered
    expect(getByText(/120 min/)).toBeTruthy();
  });

  it('should use high priority for first 10 items', () => {
    const mockVideo = createMockVideo();
    const { getByTestId } = render(
      <VideoGridItem video={mockVideo} onPress={jest.fn()} index={5} />
    );

    const image = getByTestId('poster-image');
    expect(image.props.priority).toBe('high');
  });

  it('should use normal priority for items after 10', () => {
    const mockVideo = createMockVideo();
    const { getByTestId } = render(
      <VideoGridItem video={mockVideo} onPress={jest.fn()} index={15} />
    );

    const image = getByTestId('poster-image');
    expect(image.props.priority).toBe('normal');
  });

  it('should NOT re-render when parent re-renders with same video', () => {
    const mockVideo = createMockVideo();
    const renderSpy = jest.fn();

    const TestComponent = () => {
      renderSpy();
      return <VideoGridItem video={mockVideo} onPress={jest.fn()} index={0} />;
    };

    const { rerender } = render(<TestComponent />);
    expect(renderSpy).toHaveBeenCalledTimes(1);

    rerender(<TestComponent />);
    // React.memo should prevent re-render
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('should render BlurView only when focused', () => {
    const mockVideo = createMockVideo();
    const { queryByTestId, getByTestId } = render(
      <VideoGridItem video={mockVideo} onPress={jest.fn()} index={0} />
    );

    // BlurView should not be rendered initially
    expect(queryByTestId('blur-view')).toBeNull();

    // Simulate focus
    fireEvent(getByTestId('video-card'), 'focus');

    // BlurView should now be rendered
    expect(getByTestId('blur-view')).toBeTruthy();
  });
});

describe('VideoGridItem - Platform-Specific Behavior', () => {
  it('should use TV sizing (300px) on TV platform', () => {
    Platform.isTV = true;

    const mockVideo = createMockVideo();
    const { getByTestId } = render(
      <VideoGridItem video={mockVideo} onPress={jest.fn()} index={0} />
    );

    const image = getByTestId('poster-image');
    expect(image.props.style.width).toBe(300);
  });

  it('should use phone sizing (200px) on non-TV platform', () => {
    Platform.isTV = false;

    const mockVideo = createMockVideo();
    const { getByTestId } = render(
      <VideoGridItem video={mockVideo} onPress={jest.fn()} index={0} />
    );

    const image = getByTestId('poster-image');
    expect(image.props.style.width).toBe(200);
  });
});

describe('VideoGridItem - Accessibility', () => {
  it('should have proper accessibility labels', () => {
    const mockVideo = createMockVideo({ Name: 'Test Movie' });
    const { getByA11yLabel } = render(
      <VideoGridItem video={mockVideo} onPress={jest.fn()} index={0} />
    );

    expect(getByA11yLabel('Test Movie')).toBeTruthy();
  });

  it('should have accessibility hint for interaction', () => {
    const mockVideo = createMockVideo();
    const { getByA11yHint } = render(
      <VideoGridItem video={mockVideo} onPress={jest.fn()} index={0} />
    );

    expect(getByA11yHint('Double tap to play this video')).toBeTruthy();
  });
});
```

**Expected Coverage Increase:** +8% overall

**Files Created:** 1 file, ~150 lines

---

#### Test 3: `services/__tests__/jellyfinApi.security.test.ts`

**Purpose:** Test security validation logic

**Test Coverage:**

```typescript
import { validateServerUrl, sanitizeErrorMessage, validateApiKey, validateUserId } from "../jellyfinApi";

describe("jellyfinApi - URL Validation", () => {
  it("should reject HTTP for remote servers", () => {
    const result = validateServerUrl("http://example.com:8096");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("HTTPS");
  });

  it("should allow HTTP for localhost", () => {
    expect(validateServerUrl("http://localhost:8096").valid).toBe(true);
    expect(validateServerUrl("http://127.0.0.1:8096").valid).toBe(true);
  });

  it("should allow HTTP for private IP ranges", () => {
    expect(validateServerUrl("http://192.168.1.100:8096").valid).toBe(true);
    expect(validateServerUrl("http://10.0.0.5:8096").valid).toBe(true);
    expect(validateServerUrl("http://172.16.0.1:8096").valid).toBe(true);
  });

  it("should reject invalid URL format", () => {
    const result = validateServerUrl("not a url");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid");
  });

  it("should reject non-HTTP protocols", () => {
    const result = validateServerUrl("ftp://example.com:8096");
    expect(result.valid).toBe(false);
  });
});

describe("jellyfinApi - Error Sanitization", () => {
  it("should sanitize server URLs from error messages", () => {
    const error = new Error("Failed to fetch from https://jellyfin.example.com:8096/api/users");
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

  it("should provide generic message in production", () => {
    const originalDev = __DEV__;
    __DEV__ = false;

    const error = new Error("Detailed error with https://server.com and api_key=secret");
    const sanitized = sanitizeErrorMessage(error, "API request");

    expect(sanitized).toBe("API request failed. Please check your connection and try again.");
    expect(sanitized).not.toContain("server.com");
    expect(sanitized).not.toContain("secret");

    __DEV__ = originalDev;
  });

  it("should preserve error details in development", () => {
    const originalDev = __DEV__;
    __DEV__ = true;

    const error = new Error("Fetch failed with status 500");
    const sanitized = sanitizeErrorMessage(error, "API request");

    expect(sanitized).toContain("500"); // Technical details preserved in dev

    __DEV__ = originalDev;
  });
});

describe("jellyfinApi - Input Validation", () => {
  it("should validate API key format (32 hex characters)", () => {
    expect(validateApiKey("a".repeat(32))).toBe(true);
    expect(validateApiKey("ABCDEF0123456789" + "abcdef0123456789")).toBe(true);
  });

  it("should reject invalid API key format", () => {
    expect(validateApiKey("too-short")).toBe(false);
    expect(validateApiKey("a".repeat(31))).toBe(false);
    expect(validateApiKey("a".repeat(33))).toBe(false);
    expect(validateApiKey("not-hex-chars!!!!!!!!!!!!!!!!")).toBe(false);
  });

  it("should validate User ID format (GUID)", () => {
    expect(validateUserId("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
  });

  it("should reject invalid User ID format", () => {
    expect(validateUserId("not-a-guid")).toBe(false);
    expect(validateUserId("123-456-789")).toBe(false);
  });
});
```

**Expected Coverage Increase:** +5% overall

**Files Created:** 1 file, ~120 lines

---

**Phase 1 Total:**

- **3 test files created**
- **~570 lines of test code**
- **Expected coverage increase: +27%** (51% → 78%)
- **Timeline:** 1-2 weeks

---

### Phase 2: Comprehensive Coverage (Target: 70-80%)

**Estimated Timeline:** 2-3 weeks
**Priority:** HIGH (before v1.1 release)

#### Additional Test Files:

4. `components/__tests__/FolderGridItem.test.tsx` - Similar to VideoGridItem (+3%)
5. `hooks/__tests__/useFolderContents.test.ts` - Folder load/paginate/cache (+3%)
6. `components/__tests__/FocusableButton.test.tsx` - Button variants (+3%)
7. `components/__tests__/library-grid.test.tsx` - Library/folder grid rendering (+2%)
8. `components/__tests__/error-boundary.test.tsx` - Security-critical (+4%)
9. `hooks/__tests__/useColorScheme.test.ts` - Platform detection (+1%)
10. `hooks/__tests__/useAppStateRefresh.test.ts` - App state handling (+2%)
11. `app/__tests__/player.integration.test.tsx` - Full player workflow (+5%)
12. `app/(tabs)/__tests__/settings.test.tsx` - Settings screen (+6%)
13. `app/(tabs)/__tests__/index.integration.test.tsx` - Library screen (+4%)
14. `app/(tabs)/__tests__/help.test.tsx` - Help screen (+1%)
15. `services/__tests__/multiAudioLoader.integration.test.ts` - Multi-audio E2E (+3%)

**Phase 2 Total:**

- **12 additional test files**
- **~800 lines of test code**
- **Expected coverage increase: +36%** (cumulative 86%)

---

## Testing Best Practices

### No Compliance Tests (CRITICAL)

**Definition:** A "compliance test" is a test written solely to satisfy a request or check a box, without testing real runtime behavior. These tests use unacceptable patterns like reading source files to assert something about the code text, rather than exercising actual code paths.

**Anti-Pattern Examples:**

```typescript
// ❌ BAD: Reading source code to check for string absence
import fs from "fs";
it("should not use console.log", () => {
  const source = fs.readFileSync("src/services/api.ts", "utf8");
  expect(source).not.toContain("console.log");
});

// ❌ BAD: Scanning file contents instead of testing behavior
it("should use proper error handling", () => {
  const source = fs.readFileSync("src/utils/helper.ts", "utf8");
  expect(source).toContain("try {");
});
```

**Why This Is Wrong:**

- Tests should exercise code paths, not scan text files
- Source scanning tests are fragile (break on comments, string literals, refactors)
- They provide false confidence — passing doesn't mean the code works correctly
- They test **what the code looks like**, not **what the code does**

**What To Do Instead:**

- Write a test that calls the function and asserts on its output or side effects
- If no meaningful behavioral test exists for the assertion, **skip the test entirely** — no test is better than a fake test
- Use linting rules (ESLint) for code style enforcement, not Jest tests

### Mocking External Dependencies

**Required Mocks for All Tests:**

```typescript
// jest.setup.js
jest.mock("expo-secure-store");
jest.mock("expo-router");
jest.mock("expo-image");
jest.mock("@/utils/logger");

// Mock Platform detection
jest.mock("react-native/Libraries/Utilities/Platform", () => ({
  OS: "ios",
  isTV: false,
  select: jest.fn((obj) => obj.ios),
}));
```

### Threading & Concurrency Tests

**Pattern for Race Condition Tests:**

```typescript
import { act } from "react-test-renderer";

it("should handle concurrent operations safely", async () => {
  const { result } = renderHook(() => useVideoPlayback());

  // Simulate rapid user actions
  await act(async () => {
    result.current.playVideo("video1");
    result.current.playVideo("video2"); // Before first completes
  });

  // Verify only latest operation succeeds
  expect(result.current.state).toBe("READY");
  expect(result.current.currentVideoId).toBe("video2");
});
```

### Test Harness Pattern for Contexts

**Example:**

```typescript
function TestHarness() {
  const library = useLibrary();
  const handleRef = useRef(library);
  handleRef.current = library;
  return null;
}

const { getByTestId } = render(
  <LibraryProvider>
    <TestHarness />
  </LibraryProvider>
);
```

---

## Running Tests

### Commands

```bash
npm test                          # Run all tests once
npm run test:watch                # Watch mode (recommended during development)
npm run test:coverage             # Generate coverage report
npm test -- path/to/file.test.ts  # Run single file
npm test -- --testNamePattern="should handle errors"  # Run specific test
```

### Coverage Reports

**View HTML Report:**

```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

**CI/CD Integration:**
Coverage reports are generated on every commit. Minimum threshold: 60% (will increase to 80% after Phase 2).

---

## Automated Playback Regression Suite

**Full runbook with every assumption and dependency: [`test/playback/README.md`](../test/playback/README.md). Read it before running or modifying the suite; it exists so the setup never has to be rediscovered.**

`npm run test:playback` plays each item of the local test library through the real app on a simulator (deep link `tomotv://player?videoId=<id>&probe=1`), asserts the chosen playback mode (direct / localRemux / transcode, no silent downgrade to the server), asserts playback progress, and validates the remux engine's loopback HLS against committed baselines with host ffmpeg (exact packet hashes for stream-copied video, tolerant checks for on-device transcodes).

Hard dependencies (details, manifest field reference, and known limitations in the README):

- Test media: `~/Movies/Development Videos/` (flat `T<NN> ...` naming, NOT in git; merge backup at `~/backup/test-library-merge-20260807-080642/`)
- Jellyfin server running with a library that indexes that folder (dev: "veguitas" at `http://localhost:8096`, "Movies" homevideos library rooted at `~/Movies`)
- `.env.playback-test` in the repo root (gitignored): `JELLYFIN_URL` + `JELLYFIN_API_KEY`
- The app on the simulator ALREADY SIGNED IN to that same server; the suite never logs in
- Metro running (`npm start`) for dev builds; app installed on the target simulator
- `ffmpeg`/`ffprobe` on PATH; item ids are resolved fresh from titles/paths every run, never stored anywhere

---

## Manual Testing Videos

**2026-08-07: these files were merged, deduped, and renamed into the flat `~/Movies/Development Videos/` regression library** (test5.mkv is now `T09 REMUX multi-audio.mkv`; the Sintel files are `T07 REMUX H264 AC3 embedded-subs.mkv`, `T08 REMUX H264 sidecar-subs.mkv` with matching renamed `.srt` sidecars, and `T11 REMUX H264 AAC.mkv`). Originals recoverable from `~/backup/test-library-merge-20260807-080642/`. The source URLs below remain valid for re-downloading.

For manual testing and integration testing of multi-audio, subtitle, and transcoding features, use these open-source test videos:

### test5.mkv - Multi-Audio & Embedded Subtitles

**Source:** IETF Matroska Test Files Repository
**URL:** https://github.com/ietf-wg-matroska/matroska-test-files/blob/master/test_files/test5.mkv

**Content:**

- Clip from "Elephants Dream" (Blender Foundation)
- 2 audio tracks (tests multi-audio track switching)
- 8 embedded subtitle tracks (tests embedded subtitle detection and HLS integration)

**Tests:**

- Multi-audio track switching during playback (killer feature)
- Native tvOS audio picker integration
- Audio track label display (language vs. name attributes)
- Embedded subtitle track detection
- HLS manifest generation with multiple audio streams
- Seamless audio switching without video restart

**Usage in TomoTV:**

1. Upload to Jellyfin server library
2. Play video in TomoTV
3. Verify audio track names display correctly (not "Unknown language")
4. Switch between audio tracks during playback
5. Verify seamless switching (no playback interruption)
6. Check subtitle tracks appear in native tvOS subtitle picker

---

### Sintel Videos - External Subtitle Testing

**Source:** Blender Foundation - Durian Open Movie Project
**URL:** https://durian.blender.org/download/

**Content:**

- Multiple copies of the same Sintel video file
- Each copy has different external subtitle tracks (.srt files)
- Tests external subtitle detection and WebVTT conversion

**Test Structure:**

```
sintel-external-subtitles/
├── sintel.mkv                    # Base video (no embedded subtitles)
├── sintel-english.srt            # External English subtitles
├── sintel-spanish.srt            # External Spanish subtitles
├── sintel-french.srt             # External French subtitles
└── sintel-german.srt             # External German subtitles

sintel-embedded-subtitles/
└── sintel.mkv                    # Video with embedded subtitle tracks
```

**Tests:**

- External .srt file detection
- WebVTT conversion via Jellyfin API
- HLS manifest generation with `SubtitleMethod=Hls`
- Native tvOS subtitle picker shows all tracks
- Multiple external subtitle files for same video
- Embedded vs. external subtitle handling

**Usage in TomoTV:**

1. Upload Sintel videos + .srt files to Jellyfin server
2. Ensure .srt files are in same directory as video files
3. Play video in TomoTV
4. Verify subtitle tracks appear in native tvOS subtitle picker
5. Toggle subtitles on/off during playback
6. Verify WebVTT overlay rendering (not burned-in)

---

### Test Video Naming Convention

**File naming pattern used in testing:**

- `test5.mkv` - Multi-audio + embedded subtitles
- `sintel-external-subtitles` - Same video, different external .srt tracks
- `sintel-embedded-subtitles` - Video with embedded subtitle streams

**Why these videos?**

- **Open source & legal:** All videos are free, open-licensed content
- **Comprehensive codec coverage:** Tests H.264, HEVC, and transcoding scenarios
- **Multi-audio testing:** test5.mkv has multiple audio tracks (killer feature validation)
- **Subtitle testing:** Both external (.srt) and embedded subtitle streams
- **Realistic file sizes:** ~630MB each (real-world video file sizes)
- **Public availability:** Anyone can download and use for testing

---

## Coverage Targets

| Timeframe   | Target | Status               |
| ----------- | ------ | -------------------- |
| **Current** | 51.1%  | ⚠️ Below target      |
| **Q1 2026** | 60%    | 🎯 Critical paths    |
| **Q2 2026** | 70%    | 🎯 Comprehensive     |
| **Q3 2026** | 80%    | 🎯 Industry standard |

**Breakdown by Category (Target):**

| Category   | Current | Q1 Target | Q2 Target | Final Target |
| ---------- | ------- | --------- | --------- | ------------ |
| Services   | 68%     | 75%       | 85%       | 90%          |
| Hooks      | 8%      | 60%       | 80%       | 85%          |
| Components | 0%      | 50%       | 70%       | 80%          |
| Contexts   | 60%     | 75%       | 80%       | 85%          |
| Utils      | 91%     | 91%       | 95%       | 95%          |

---

## Mock Data Patterns

### Reusable Mock Factories

**Create: `test-utils/mockData.ts`**

```typescript
export function createMockVideo(overrides?: Partial<JellyfinVideoItem>): JellyfinVideoItem {
  return {
    Id: "mock-video-123",
    Name: "Test Movie",
    Type: "Movie",
    RunTimeTicks: 7200000000, // 2 hours
    MediaSources: [
      {
        Id: "source-1",
        Container: "mkv",
        Size: 5000000000,
      },
    ],
    MediaStreams: [
      { Type: "Video", Codec: "h264", Index: 0, Height: 1080 },
      { Type: "Audio", Codec: "aac", Index: 1, Language: "eng" },
    ],
    ...overrides,
  };
}

export function createMockH264Video(): JellyfinVideoItem {
  return createMockVideo({
    MediaStreams: [
      { Type: "Video", Codec: "h264", Index: 0 },
      { Type: "Audio", Codec: "aac", Index: 1 },
    ],
  });
}

export function createMockHevcVideo(): JellyfinVideoItem {
  return createMockVideo({
    MediaStreams: [
      { Type: "Video", Codec: "hevc", Index: 0 },
      { Type: "Audio", Codec: "aac", Index: 1 },
    ],
  });
}

export function createMockMultiAudioVideo(): JellyfinVideoItem {
  return createMockVideo({
    MediaStreams: [
      { Type: "Video", Codec: "h264", Index: 0 },
      { Type: "Audio", Codec: "aac", Index: 1, Language: "eng", IsDefault: true },
      { Type: "Audio", Codec: "ac3", Index: 2, Language: "spa" },
      { Type: "Audio", Codec: "dts", Index: 3, Language: "fra" },
    ],
  });
}

export function createMockFolder(): JellyfinItem {
  return {
    Id: "folder-123",
    Name: "Movies",
    Type: "Folder",
    ChildCount: 42,
  };
}
```

---

## Test File Naming Conventions

- **Unit tests:** `*.test.ts` or `*.test.tsx`
- **Integration tests:** `*.integration.test.tsx`
- **Threading tests:** `*.threading.test.ts`
- **Security tests:** `*.security.test.ts`

All test files located in `__tests__` folders next to source files.

---

## Continuous Improvement

### Monthly Review Checklist

- [ ] Check coverage trends (should increase, not decrease)
- [ ] Identify new critical paths introduced
- [ ] Update test priorities based on bug reports
- [ ] Remove obsolete tests (dead code)
- [ ] Review test quality (not just quantity)

### Test Debt Tracking

See GitHub Issues tagged with `testing` label for known gaps and planned improvements.

---

## Security Testing Requirements

All security-critical code **MUST** have 95%+ coverage:

- [ ] URL validation (`app/(tabs)/settings.tsx`)
- [ ] Error sanitization (`services/jellyfinApi.ts`)
- [ ] Input validation (API key, User ID regex)
- [ ] SecureStore integration (credential storage)
- [ ] ErrorBoundary component (prevents credential leakage)
- [ ] Demo mode flag protection

**Security Test Review:** Before every release, manually review security test coverage.

---

## Performance Testing

**Not Currently Implemented (Future Work):**

- Render performance benchmarks (FlatList with 1000+ items)
- Memory leak detection (profiling tools)
- Animation performance (FPS measurement)
- Network performance (mock slow connections)

---

**Document Prepared By:** AI Code Audit Team
**Testing Agent:** aa05662
**Last Updated:** January 24, 2026
**Next Review:** April 2026 or when coverage < 75%
