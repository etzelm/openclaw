undef $/;
my $f = "$ENV{HOME}/Library/Caches/pr165112-sandbox/h/summarize.mjs";
open(F, "<", $f) or die; my $s = <F>; close F;
$s =~ s/JSON\.stringify\(i\.content\)/(Array.isArray(i.content) ? i.content.map((c) => c.text ?? "").join("\\n") : String(i.content))/ or die "no content";
open(F, ">", $f) or die; print F $s; close F;
