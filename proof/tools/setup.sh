#!/bin/bash
# usage: setup.sh <arm> <tree>
set -e
arm=$1; tree=$2
P=<scratch>; S=$P/scratch/$arm
rm -rf $S; mkdir -p $S/home $S/state
mkdir -p $P/synthetic/$arm/logs
cat > $S/state/openclaw.json <<CFG
{
  agents: { defaults: { workspace: "$S/state/workspace" } },
  memory: { search: { enabled: true, provider: "none", sources: ["memory"] } },
  plugins: { slots: { memory: "memory-core" }, entries: { "memory-core": { enabled: true } } },
  gateway: { mode: "local" },
  logging: { file: "$P/synthetic/$arm/openclaw.log" },
}
CFG
cp $S/state/openclaw.json $P/synthetic/$arm/openclaw.json
node $P/tools/gen-synthetic-memory.mjs $S/state/workspace 400 24 > $P/synthetic/$arm/logs/gen.out
(cd $S/state/workspace && find . -type f | sort | xargs shasum -a 256 | shasum -a 256) > $P/synthetic/$arm/logs/workspace-manifest.sha256
cd /tmp
node $P/tools/oc.mjs $arm $tree $P/synthetic/$arm/logs index none -- memory index --force --agent main --verbose
node $P/tools/oc.mjs $arm $tree $P/synthetic/$arm/logs status none -- memory status --json --agent main
