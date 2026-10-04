#!/bin/bash
cd $HOME/work/164796-kc
KC=$PWD/latency.keychain-db
/usr/bin/security create-keychain -p probe "$KC" && /usr/bin/security unlock-keychain -p probe "$KC" && /usr/bin/security add-generic-password -a kc-latency-probe -s "Claude Code-credentials-latency-probe" -w '{"claudeAiOauth":{"accessToken":"synthetic","expiresAt":1893456000000}}' -T /usr/bin/security "$KC"
$HOME/homebrew/bin/node lat.mjs "$KC"
/usr/bin/security delete-keychain "$KC"
echo "search list after cleanup: [$(/usr/bin/security list-keychains -d user | tr -d ' \n')]"
