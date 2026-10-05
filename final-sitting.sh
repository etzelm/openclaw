#!/bin/bash
export PATH=$HOME/homebrew/bin:$PATH
cd ~/work/165112-proof
echo "sitting start $(date -u +%FT%TZ) tree $(git -C ~/work/165112 rev-parse HEAD^{tree}) base $(git -C ~/work/165112-base rev-parse HEAD)"
for c in "root 19300" "subdir 19310" "neither 19320" "both 19330"; do ./run-case.sh $c; done
seam() { # case config label
  local P=$PWD/p-$1
  env -i PATH=$PATH HOME=$P OPENCLAW_HOME=$P OPENCLAW_STATE_DIR=$P/state TMPDIR=$P REPO=$HOME/work/165112 \
    node --import $HOME/work/165112/scripts/tsx.mjs sandbox-seam.mts "$2" "$P" "$3" 2>&1 | sed -e "s#$HOME#~#g"
}
{
seam root root-config-before.json "before Doctor (any case; the unpinned config is identical)"
echo; seam root root-config-after.json "after Doctor, root case (pinned to the shared root)"
echo; seam subdir subdir-config-after.json "after Doctor, subdir case (pinned to the agent directory)"
echo; seam neither neither-config-after.json "after Doctor, neither case (pinned to the agent directory)"
echo; seam both both-config-after.json "after Doctor, both case (left unchanged, warning)"
} > sandbox.out
echo "sitting end $(date -u +%FT%TZ)"
