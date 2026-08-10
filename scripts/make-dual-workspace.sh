#!/usr/bin/env bash
# Generates a root-level TomoTV.xcworkspace that references both the iOS (ios/)
# and tvOS (tvos/) projects plus their Pods, so both platforms open in one
# Xcode window. Run by `npm run prebuild:dual` after both prebuilds finish.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d ios/TomoTV.xcodeproj ] || [ ! -d tvos/TomoTV.xcodeproj ]; then
  echo "make-dual-workspace: need both ios/ and tvos/ projects. Run npm run prebuild:dual first." >&2
  exit 1
fi

# Rename both schemes so the picker shows "TomoTV-iOS" and "TomoTV-tvOS"
# instead of two identical "TomoTV" entries.
TV_SCHEME_DIR="tvos/TomoTV.xcodeproj/xcshareddata/xcschemes"
if [ -f "$TV_SCHEME_DIR/TomoTV.xcscheme" ]; then
  mv "$TV_SCHEME_DIR/TomoTV.xcscheme" "$TV_SCHEME_DIR/TomoTV-tvOS.xcscheme"
fi
IOS_SCHEME_DIR="ios/TomoTV.xcodeproj/xcshareddata/xcschemes"
if [ -f "$IOS_SCHEME_DIR/TomoTV.xcscheme" ]; then
  mv "$IOS_SCHEME_DIR/TomoTV.xcscheme" "$IOS_SCHEME_DIR/TomoTV-iOS.xcscheme"
fi

mkdir -p TomoTV.xcworkspace
cat > TomoTV.xcworkspace/contents.xcworkspacedata <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<Workspace
   version = "1.0">
   <FileRef
      location = "group:ios/TomoTV.xcodeproj">
   </FileRef>
   <FileRef
      location = "group:ios/Pods/Pods.xcodeproj">
   </FileRef>
   <FileRef
      location = "group:tvos/TomoTV.xcodeproj">
   </FileRef>
   <FileRef
      location = "group:tvos/Pods/Pods.xcodeproj">
   </FileRef>
</Workspace>
EOF

# Stop Xcode from auto-creating schemes for every target (Pods, extensions),
# which would put duplicate unlabeled "TomoTV" entries back in the picker.
mkdir -p TomoTV.xcworkspace/xcshareddata
cat > TomoTV.xcworkspace/xcshareddata/WorkspaceSettings.xcsettings <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>IDEWorkspaceSharedSettings_AutocreateContextsIfNeeded</key>
	<false/>
</dict>
</plist>
EOF

echo "make-dual-workspace: wrote TomoTV.xcworkspace (open with: xed TomoTV.xcworkspace)"
