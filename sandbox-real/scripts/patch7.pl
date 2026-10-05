undef $/;
my $f = "$ENV{HOME}/Library/Caches/pr165112-sandbox/h/summarize.mjs";
open(F, "<", $f) or die; my $s = <F>; close F;
$s =~ s/\.filter\(\(l\) => \/working directory\|sandbox\|\\\/agent\|\\\/workspace\/i\.test\(l\)\)/.filter((l) => !l.includes("<location>") \&\& !l.includes("sessions_list") \&\& \/working directory|sandbox|\\\/agent|workspace access|workspace dir\/i.test(l))/ or die "no filter";
open(F, ">", $f) or die; print F $s; close F;
