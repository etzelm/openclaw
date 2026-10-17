# Scrub

Pure substitutions applied with sed to every text file copied under gateway/, synthetic/observer-final-summary.md and synthetic/<arm>/{obs-final,logs-final}:

1. `<scratch-root>` -> `<scratch>`
2. remaining `<home-root>` -> `<home>`
3. `127.0.0.1:18791` / `127.0.0.1:18792` -> `127.0.0.1:<port>` (ws URLs next to an IP only). The port also still appears as the bare `--port 18791|18792` argument and in log lines such as bonjour `port=18791`; those are intentionally left (rule: replace only next to an IP).

Commands:

    sed -i '' -e 's#<scratch-root>#<scratch>#g' -e 's#<home-root>#<home>#g' -e 's#127\.0\.0\.1:1879[12]#127.0.0.1:<port>#g' FILE

The token `<test-token>` is a throwaway local proof token and was left as is. Unmodified copies of the helper scripts (observe-reconcile-count.mjs, oc-final.mjs, oc-gw.mjs, final-summary.mjs, gw-summary.mjs) are in gateway/ and contain scratch paths scrubbed the same way.

Note: `<scratch-root>` and `<home-root>` above stand for the literal scratch directory and home directory on the run host; the literal values are not reproduced here.
