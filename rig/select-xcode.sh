#!/bin/bash
# Select the newest installed Xcode that meets OpenClaw's floor (Xcode 26.4, Swift tools 6.3).
set -euo pipefail
best=""
best_version="0"
for app in /Applications/Xcode*.app; do
  plist="$app/Contents/Info.plist"
  [ -f "$plist" ] || continue
  version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>/dev/null || echo 0)"
  echo "found $app ($version)"
  if [ "$(printf '%s\n%s\n' "$best_version" "$version" | sort -V | tail -1)" = "$version" ] && [ "$version" != "$best_version" ]; then
    best="$app"
    best_version="$version"
  fi
done
if [ -z "$best" ] || [ "$(printf '%s\n26.4\n' "$best_version" | sort -V | head -1)" != "26.4" ]; then
  echo "::error::No Xcode 26.4 or newer installed (best: ${best:-none} $best_version)"
  exit 1
fi
sudo xcode-select -s "$best/Contents/Developer"
xcodebuild -version
swift --version
