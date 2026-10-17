#!/bin/bash
# Runs the identical scenario on both arms, alternating arms per configuration.
ROOT=$1; T=$(cd "$(dirname "$0")" && pwd)
for cfg in "keyword 100" "semantic 100" "semantic-nocache 100" "keyword 2000" "semantic-nocache 2000"; do
  set -- $cfg
  for arm in base head; do
    echo "=== $arm $1 p$2 load: $(sysctl -n vm.loadavg)"
    "$T/run-arm.sh" "$arm" "$1" "$2" "$ROOT" > /dev/null 2>&1; echo "exit $?"
  done
done
echo ALL-DONE
