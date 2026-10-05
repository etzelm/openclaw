undef $/;
my $f = "$ENV{HOME}/Library/Caches/pr165112-sandbox/h/run-case.sh";
open(F, "<", $f) or die; my $s = <F>; close F;
my $reset = 'rm -rf "$P/state/sandboxes"' . "\n" . 'for c in $(docker ps -a --filter name=pr165112-sbx- --format \'{{.Names}}\'); do docker rm -f "$c" >/dev/null 2>&1; done' . "\n";
$s =~ s/^cd "\$REPO" \|\| exit 9\n/$reset . "cd \"\$REPO\" || exit 9\n"/me;
open(F, ">", $f) or die; print F $s; close F;
