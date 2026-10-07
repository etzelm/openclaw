#!/bin/bash
E=~/work/oss-166304-r4
bash "$E/evidence.sh"
bash "$E/evidence2.sh"
bash "$E/sweep.sh"
bash "$E/mutants.sh"
echo "CHAIN DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$E/chain-done.txt"
