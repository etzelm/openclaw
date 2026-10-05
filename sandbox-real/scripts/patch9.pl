undef $/;
my $f = "$ENV{HOME}/Library/Caches/pr165112-sandbox/h/harness.mjs";
open(F, "<", $f) or die; my $s = <F>; close F;
$s =~ s/  if \(fs\.existsSync\(path\.join\(ROOT, "main"\)\)\) \{\n    mkfile\(path\.join\(ROOT, "main", "pr165112-control\.txt"\), "CONTROL-MAIN\\n"\);\n  \}\n/  mkfile(path.join(ROOT, "main", "pr165112-control.txt"), "CONTROL-MAIN\\n");\n/ or die "no main ctl";
open(F, ">", $f) or die; print F $s; close F;
