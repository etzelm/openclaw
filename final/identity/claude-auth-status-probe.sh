#!/bin/bash
# Real Claude CLI, fully synthetic login files: does `claude auth status --json` attest the
# credential's account, or report the local account record?
D=$(mktemp -d /tmp/auth-probe.XXXX); chmod 700 $D; mkdir -p $D/cfg $D/home
echo "claude --version: $(claude --version)"
cred(){ printf '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-SYNTHETIC-%s","refreshToken":"sk-ant-ort01-SYNTHETIC-%s","expiresAt":4102444800000,"scopes":["user:inference","user:profile"],"subscriptionType":"pro"}}' "$1" "$1" > $D/cfg/.credentials.json; }
rec(){ printf '{"oauthAccount":{"accountUuid":"%s","emailAddress":"%s@example.invalid","organizationUuid":"%s","organizationName":"Org %s"}}' "$1" "$2" "$3" "$2" > $D/cfg/.claude.json; }
run(){ echo "--- $1"; s=$(python3 -c 'import time;print(time.time())'); out=$(env -i HOME=$D/home PATH=$PATH USER=nobody CLAUDE_CONFIG_DIR=$D/cfg claude auth status --json 2>/dev/null); rc=$?; e=$(python3 -c 'import time;print(time.time())'); echo "exit=$rc ms=$(python3 -c "print(int(($e-$s)*1000))")"; echo "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); [d.pop(k,None) for k in ("projectsDirectory","configDirectory")]; print(json.dumps(d))'; }
cred A; rec 11111111-1111-1111-1111-111111111111 record-a 22222222-2222-2222-2222-222222222222
run "synthetic credential A, account record A"
rec 33333333-3333-3333-3333-333333333333 record-b 44444444-4444-4444-4444-444444444444
run "same credential A, account record edited to B"
cred B
run "credential replaced with B, record B"
rm $D/cfg/.credentials.json
run "credential removed, record B kept"
rm -rf $D
