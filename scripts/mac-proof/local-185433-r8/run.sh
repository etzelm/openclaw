#!/bin/bash
# #185433 round 8 laptop driver. Phases: setup | build-new | build-r7 | build-old | build-base | tests
#   | after | before | stolen-new | stolen-r7 | retire-new | retire-r7
# Work dir ~/work/fw6r8 only. Ports 28789/28790/38790 loopback. Profile fw6r8, bundle ai.openclaw.mac.debug.
set -uo pipefail
export PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
W=~/work/fw6r8
M=~/work/fw6r8-ctl/mnt/scratch/fw6-r8
NEW_SHA=98f66694ae2dde1a19db163a2688db9b6c96beb4
R7_SHA=2031987bfa4cc0b2ff871d4df71884667805bdd7
OLD_SHA=7bdf01c0b323cfc4fcf0d2c1b7d32c4a4feaba3c
BASE_SHA=5291a06cc263f0815fa087fd02bbdb29c3839089
LIB_SHA=f354d51cefd0d5fc21967fae807d90a405e9e3ba
die() { echo "STOP: $*"; exit 1; }
export PATH="$W/tools/bin:$PATH"
phase="${1:?phase}"

build_tree() { # build_tree <dir> <label> [app]
  cd "$1" || die "cd $1"
  pnpm install --frozen-lockfile >"$W/install-$2.log" 2>&1 || die "install $2"
  pnpm build >"$W/build-$2.log" 2>&1 || die "build $2"
  if [[ "${3:-}" == app ]]; then
    BUILD_CONFIG=debug BUILD_ARCHS=arm64 OPENCLAW_SKIP_MLX_TTS=1 SIGN_IDENTITY=- ALLOW_ADHOC_SIGNING=1 \
      DISABLE_LIBRARY_VALIDATION=1 SKIP_TEAM_ID_CHECK=1 ./scripts/package-mac-app.sh >"$W/package-$2.log" 2>&1 \
      || die "package $2"
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f dist/OpenClaw.app
  fi
  echo "built $2 at $(git -C "$1" rev-parse HEAD)"
}

scenario() { # scenario <script> <variant> <src> <sha> <outdir> [extra env...]
  local script="$1" variant="$2" src="$3" sha="$4" out="$5"; shift 5
  lsof -nP -iTCP:28789 -iTCP:28790 -iTCP:38790 -sTCP:LISTEN | grep -q . && die "ports busy before $out"
  rm -rf "$W/$out" "$W/tmp-$out"; mkdir -p "$W/$out"
  env SRC="$src" OUT="$W/$out" HARNESS="$W/harness" APP="$W/new/dist/OpenClaw.app" \
    ITEM=6 VARIANT="$variant" PR=185433 EXPECTED_SHA="$sha" \
    PP_LOCAL=1 PP_APP_PROFILE=fw6r8 PP_BUNDLE_ID=ai.openclaw.mac.debug RUNNER_TEMP="$W/tmp-$out" \
    PP_BROWSER_APP="Google Chrome" PP_BROWSER_UA=Chrome "$@" \
    /bin/bash "$W/harness/scripts/mac-proof/$script"
  echo "$out exit=$?" | tee -a "$W/summary.txt"
  grep -E '^[0-9:]+ (PASS|FAIL|RESULT|allowed open via|final-effect|stolen port armed|before outside|after outside|outside click|inside click|widget saw|warning|double click|control:|retire:|retire click|timing instrumentation)' \
    "$W/$out/scenario.log" | tee -a "$W/summary.txt"
}

# Proof-only timing for leg 6r: the served proxy holds its activation answer
# 2.5 s and the dashboard waits up to 10 s for it. Backups are restored by
# `uninstrument`. Each replacement must match exactly once.
instrument() { # instrument <tree>
  local t="$1" list="$W/instrumented-$(basename "$1")" f
  local proxy ui
  proxy="$(grep -rlF 'ui/notifications/sandbox-activation-query' "$t/dist" | grep -v -e '/control-ui/' -e 'OpenClaw.app' -e '\.map$')"
  ui="$(grep -rlF 'ui/notifications/sandbox-activation-query' "$t/dist/control-ui" | grep -v '\.map$')"
  [[ -n "$proxy" && "$(echo "$ui" | grep -c .)" == 1 ]] || die "instrument targets: proxy=[$proxy] ui=[$ui]"
  : >"$list"
  for f in $proxy $ui $ui.gz $ui.br; do
    [[ -f "$f" ]] || continue
    cp "$f" "$f.fw6bak" || die backup; echo "$f" >>"$list"
  done
  node "$M/instrument.mjs" proxy $proxy || { uninstrument "$t"; die "instrument proxy"; }
  node "$M/instrument.mjs" ui $ui || { uninstrument "$t"; die "instrument ui"; }
}
uninstrument() { # uninstrument <tree>
  local f list="$W/instrumented-$(basename "$1")"
  [[ -f "$list" ]] || return 0
  while read -r f; do mv "$f.fw6bak" "$f" || echo "warning: restore $f failed"; done <"$list"
  rm -f "$list"
}

case "$phase" in
setup)
  [ -e "$W" ] && die "$W exists"
  [ -z "$(mdfind "kMDItemCFBundleIdentifier == 'ai.openclaw.mac.debug'")" ] || die "a debug OpenClaw build exists"
  mkdir -p "$W/tools" && cd "$W" || die mkdir
  npm i -g --prefix "$W/tools" pnpm@12.15.0 >/dev/null 2>&1 || die pnpm
  swiftc -O -o "$W/tools/input" "$M/input.swift" 2>/dev/null || die input-tool
  git clone -q --filter=blob:none --no-checkout https://github.com/etzelm/openclaw.git new || die clone
  git -C new fetch -q "$M/prr185433-r8.bundle" "prr-185433-r8:refs/heads/r8" || die bundle
  git -C new checkout -q "$NEW_SHA" || die checkout-new
  git -C new worktree add -q --detach "$W/r7" "$R7_SHA" || die wt-r7
  git -C new worktree add -q --detach "$W/old" "$OLD_SHA" || die wt-old
  git -C new worktree add -q --detach "$W/base" "$BASE_SHA" || die wt-base
  git clone -q --filter=blob:none --branch mac/proof-5 https://github.com/etzelm/openclaw.git harness || die harness
  [ "$(git -C harness rev-parse HEAD)" = "$LIB_SHA" ] || die "proof-5 moved"
  cp "$M/6.sh" "$M/6s.sh" "$M/6r.sh" harness/scripts/mac-proof/ || die cp-scn
  for d in new r7 old base; do echo "$d $(git -C $d rev-parse HEAD) signed=$(git -C $d log -1 --format=%G?)"; done
  shasum harness/scripts/mac-proof/6.sh harness/scripts/mac-proof/6s.sh harness/scripts/mac-proof/6r.sh
  ;;
build-new) build_tree "$W/new" new app ;;
build-r7) build_tree "$W/r7" r7 ;;
build-old) build_tree "$W/old" old ;;
build-base) build_tree "$W/base" base ;;
tests)
  cd "$W/new" || die cd
  pnpm --dir ui test src/lib/board/widget-bridge.test.ts src/lib/board/widget-sandbox-host.test.ts >"$W/tests.log" 2>&1
  echo "tests exit=$?" | tee -a "$W/summary.txt"
  grep -E "Test Files  |Tests  " "$W/tests.log" | tee -a "$W/summary.txt"
  ;;
after) scenario 6.sh head "$W/new" "$NEW_SHA" after ;;
before) scenario 6.sh base "$W/base" "$BASE_SHA" before ;;
stolen-new) scenario 6s.sh stolen-new "$W/new" "$NEW_SHA" stolen-new SEED_SRC="$W/old" PP_KEY_TOOL="$W/tools/input" ;;
stolen-r7) scenario 6s.sh stolen-r7 "$W/r7" "$R7_SHA" stolen-r7 SEED_SRC="$W/old" PP_KEY_TOOL="$W/tools/input" ;;
retire-new|retire-r7)
  t="$W/new"; sha="$NEW_SHA"; [[ "$phase" == retire-r7 ]] && { t="$W/r7"; sha="$R7_SHA"; }
  instrument "$t"
  scenario 6r.sh "$phase" "$t" "$sha" "$phase" FW6_INSTRUMENT="proxy holds activation answers 2500 ms; dashboard query timeout 10000 ms"
  uninstrument "$t"
  ;;
*) die "unknown phase $phase" ;;
esac
