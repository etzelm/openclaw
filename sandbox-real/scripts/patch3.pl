undef $/;
my $f = "$ENV{HOME}/Library/Caches/pr165112-sandbox/h/run-case.sh";
open(F, "<", $f) or die; my $s = <F>; close F;
my $kill = 'for p in $(lsof -nP -tiTCP:$GW_PORT -tiTCP:$MOCK_PORT -sTCP:LISTEN 2>/dev/null); do kill $p 2>/dev/null; done' . "\n" . 'i=0; while [ -n "$(lsof -nP -tiTCP:$GW_PORT -tiTCP:$MOCK_PORT -sTCP:LISTEN 2>/dev/null)" ] && [ $i -lt 20 ]; do i=$((i+1)); sleep 1; done' . "\n";
my $guard = 'if [ -n "$(lsof -nP -tiTCP:$GW_PORT -tiTCP:$MOCK_PORT -sTCP:LISTEN 2>/dev/null)" ]; then echo "ports busy" > "$OUT/ABORT"; exit 8; fi' . "\n";
$s =~ s/^(kill -9 \$GW_PID \$MOCK_PID 2>\/dev\/null\n)/$1$kill/m or die "no kill";
$s =~ s/^(node scripts\/e2e\/mock-openai-server\.mjs)/$guard$1/m or die "no mock";
open(F, ">", $f) or die; print F $s; close F;
