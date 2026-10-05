undef $/;
my $f = "$ENV{HOME}/Library/Caches/pr165112-sandbox/h/run-case.sh";
open(F, "<", $f) or die; my $s = <F>; close F;
$s =~ s/^rm -rf "\$P\/state\/sandboxes"\nfor c in .*?\n//m or die "no reset";
open(F, ">", $f) or die; print F $s; close F;
