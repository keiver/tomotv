#!/usr/bin/env bash
# Generates a root-level TomoTV.xcworkspace for iOS and tvOS, plus macOS with
# --all. Renames the project bundles, Pods projects, and schemes with
# -iOS / -tvOS / -macOS suffixes so the platforms are distinguishable in the
# navigator and the scheme picker. Retargets the scheme, fallback workspace,
# and explicit app-to-Pods dependency to the renamed bundles.
# Run by prebuild:dual and prebuild:all after generation. Idempotent.
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/native-build-lock.sh

# suffix_platform <dir> <suffix>: rename TomoTV.xcodeproj, Pods.xcodeproj, and
# the shared scheme in <dir> to carry <suffix>. Pieces already renamed are
# skipped so reruns are safe.
suffix_platform() {
  local dir="$1" suffix="$2"

  if [ -d "$dir/TomoTV.xcodeproj" ]; then
    mv "$dir/TomoTV.xcodeproj" "$dir/TomoTV-$suffix.xcodeproj"
  fi
  if [ ! -d "$dir/TomoTV-$suffix.xcodeproj" ]; then
    echo "make-dual-workspace: no TomoTV project in $dir/. Run npm run prebuild:all first." >&2
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
  node scripts/link-platform-pods.js "$dir" "$suffix"

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

PLATFORMS=("ios:iOS" "tvos:tvOS")
case "${1:-}" in
  --mac-only) suffix_platform macos macOS; exit 0 ;;
  --all) PLATFORMS=("ios:iOS" "macos:macOS" "tvos:tvOS") ;;
  "") ;;
  *) echo "Usage: $0 [--all|--mac-only]" >&2; exit 1 ;;
esac
for platform in "${PLATFORMS[@]}"; do
  IFS=: read -r dir suffix <<< "$platform"
  suffix_platform "$dir" "$suffix"
done

mkdir -p TomoTV.xcworkspace
{
  cat <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<Workspace
   version = "1.0">
EOF
  for platform in "${PLATFORMS[@]}"; do
    IFS=: read -r dir suffix <<< "$platform"
    cat <<EOF
   <FileRef
      location = "group:$dir/TomoTV-$suffix.xcodeproj">
   </FileRef>
   <FileRef
      location = "group:$dir/Pods/Pods-$suffix.xcodeproj">
   </FileRef>
EOF
  done
  echo '</Workspace>'
} > TomoTV.xcworkspace/contents.xcworkspacedata

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

echo "make-dual-workspace: wrote TomoTV.xcworkspace (open with: open -a Xcode TomoTV.xcworkspace)"
