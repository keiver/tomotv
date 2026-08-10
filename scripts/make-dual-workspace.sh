#!/usr/bin/env bash
# Generates a root-level TomoTV.xcworkspace that references both the iOS (ios/)
# and tvOS (tvos/) projects plus their Pods, so both platforms open in one
# Xcode window. Renames the project bundles, Pods projects, and schemes with
# -iOS / -tvOS suffixes so the two platforms are distinguishable in the
# navigator and the scheme picker. Safe: nothing else references the bundle
# filenames (pbxproj has zero refs, Podfile declares no project, expo CLI
# globs ios/*.xcodeproj) except the scheme's ReferencedContainer, patched here.
# Run by `npm run prebuild:dual` after both prebuilds finish. Idempotent.
set -euo pipefail

cd "$(dirname "$0")/.."

# suffix_platform <dir> <suffix>: rename TomoTV.xcodeproj, Pods.xcodeproj, and
# the shared scheme in <dir> to carry <suffix>. Pieces already renamed are
# skipped so reruns are safe.
suffix_platform() {
  local dir="$1" suffix="$2"

  if [ -d "$dir/TomoTV.xcodeproj" ]; then
    mv "$dir/TomoTV.xcodeproj" "$dir/TomoTV-$suffix.xcodeproj"
  fi
  if [ ! -d "$dir/TomoTV-$suffix.xcodeproj" ]; then
    echo "make-dual-workspace: no TomoTV project in $dir/. Run npm run prebuild:dual first." >&2
    exit 1
  fi

  if [ -d "$dir/Pods/Pods.xcodeproj" ]; then
    mv "$dir/Pods/Pods.xcodeproj" "$dir/Pods/Pods-$suffix.xcodeproj"
  fi

  local schemes="$dir/TomoTV-$suffix.xcodeproj/xcshareddata/xcschemes"
  if [ -f "$schemes/TomoTV.xcscheme" ]; then
    mv "$schemes/TomoTV.xcscheme" "$schemes/TomoTV-$suffix.xcscheme"
  fi
  # The scheme still points at the pre-rename container; retarget it.
  if [ -f "$schemes/TomoTV-$suffix.xcscheme" ]; then
    sed -i '' "s|container:TomoTV.xcodeproj|container:TomoTV-$suffix.xcodeproj|g" "$schemes/TomoTV-$suffix.xcscheme"
  fi

  # Keep the per-platform fallback workspace working with the renamed bundles.
  cat > "$dir/TomoTV.xcworkspace/contents.xcworkspacedata" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<Workspace
   version = "1.0">
   <FileRef
      location = "group:TomoTV-$suffix.xcodeproj">
   </FileRef>
   <FileRef
      location = "group:Pods/Pods-$suffix.xcodeproj">
   </FileRef>
</Workspace>
EOF
}

suffix_platform ios iOS
suffix_platform tvos tvOS

mkdir -p TomoTV.xcworkspace
cat > TomoTV.xcworkspace/contents.xcworkspacedata <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<Workspace
   version = "1.0">
   <FileRef
      location = "group:ios/TomoTV-iOS.xcodeproj">
   </FileRef>
   <FileRef
      location = "group:ios/Pods/Pods-iOS.xcodeproj">
   </FileRef>
   <FileRef
      location = "group:tvos/TomoTV-tvOS.xcodeproj">
   </FileRef>
   <FileRef
      location = "group:tvos/Pods/Pods-tvOS.xcodeproj">
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
