#!/bin/sh
# usage: oc.sh <src-name> <home> <openclaw args...>   (inert env, scratch DSN, stub `claude` first on PATH)
W=$HOME/work/pc-190001; S=$1; H=$2; shift 2
. $W/scripts/env_dsn.sh
mkdir -p $W/fakeclaude/dir && cp $W/scripts/fake-claude.js $W/fakeclaude/claude && chmod 755 $W/fakeclaude/claude && touch $W/fakeclaude/dir/turn-release
cd $H || exit 1
exec env -i PATH=$W/fakeclaude:$PATH FAKE_CLAUDE_DIR=$W/fakeclaude/dir HOME=$H OPENCLAW_HOME=$H OPENCLAW_CONFIG_PATH=$H/.openclaw/openclaw.json OPENCLAW_NO_RESPAWN=1 CI=1 NO_COLOR=1 OPENCLAW_SKIP_CHANNELS=1 OPENCLAW_SKIP_CRON=1 OPENCLAW_SKIP_PROVIDERS=1 OPENCLAW_SKIP_GMAIL_WATCHER=1 OPENCLAW_SKIP_BROWSER_CONTROL_SERVER=1 OPENCLAW_SKIP_CANVAS_HOST=1 LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 OPENCLAW_DATABASE_DSN="$OPENCLAW_DATABASE_DSN" CLAUDE_CONFIG_DIR=$H/.claude node $W/src-$S/dist/entry.js "$@"
