#!/usr/bin/env bash
# Inspect the exported payload, including both Catalyst architectures.
set -euo pipefail
PKG="$1"
EXPECTED_BUILD="$2"
EXPECTED_VERSION="$3"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pkgutil --check-signature "$PKG" > "$TMP/signature.txt"
grep -q '3rd Party Mac Developer Installer:' "$TMP/signature.txt" || {
  echo "Mac package is missing its Mac App Store installer signature." >&2; exit 1;
}
pkgutil --expand-full "$PKG" "$TMP/expanded"
APP="$(find "$TMP/expanded" -type d -name TomoTV.app -print -quit)"
[ -n "$APP" ] || { echo "No TomoTV.app in $PKG" >&2; exit 1; }
codesign --verify --deep --strict "$APP"
codesign -d --entitlements :- "$APP" > "$TMP/entitlements.plist" 2>/dev/null
python3 - "$APP" "$TMP/entitlements.plist" "$EXPECTED_BUILD" "$EXPECTED_VERSION" <<'PY'
import pathlib, plistlib, subprocess, sys
app = pathlib.Path(sys.argv[1])
with (app / 'Contents/Info.plist').open('rb') as f:
    info = plistlib.load(f)
assert info['CFBundleIdentifier'] == 'dev.keiver.tomotv', 'Mac bundle ID changed'
assert info['CFBundleVersion'] == sys.argv[3], 'Mac build number mismatch'
assert info['CFBundleShortVersionString'] == sys.argv[4], 'Mac version mismatch'
assert info['DTPlatformName'] == 'macosx', 'Not a Mac package'
with open(sys.argv[2], 'rb') as f:
    entitlements = plistlib.load(f)
for key in ['app-sandbox', 'network.client', 'network.server']:
    assert entitlements.get('com.apple.security.' + key) is True, f'Missing sandbox entitlement {key}'
assert not entitlements.get('get-task-allow'), 'Development debugging entitlement in release'
assert not entitlements.get('com.apple.security.get-task-allow'), 'Development debugging entitlement in release'
binary = app / 'Contents/MacOS' / info['CFBundleExecutable']
arches = subprocess.check_output(['lipo', '-archs', str(binary)], text=True).split()
assert set(arches) == {'arm64', 'x86_64'}, f'Expected universal Mac executable, found {arches}'
for arch in arches:
    load_commands = subprocess.check_output(['xcrun', 'vtool', '-arch', arch, '-show-build', str(binary)], text=True)
    assert 'MACCATALYST' in load_commands, f'{arch} was not built for Catalyst'
print('Mac package verified: signatures, version, sandbox, and universal Catalyst executable')
PY
