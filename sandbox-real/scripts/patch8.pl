undef $/;
my $f = "$ENV{HOME}/Library/Caches/pr165112-sandbox/h/report.mjs";
open(F, "<", $f) or die; my $s = <F>; close F;
$s =~ s/const hostProbeSec = .*?;\n/const hostProbeSec = (hv.match(\/--- probe files present[^\\n]*\\n([\\s\\S]*?)--- sandbox dir\/)?.[1] ?? "").split("\\n").filter(Boolean);\n  const sbxProbe = (hv.match(\/--- sandbox dir[^\\n]*\\n([\\s\\S]*)\$\/)?.[1] ?? "").split("\\n").filter(Boolean).map((x) => x.replace(\/^.*\\\/state\\\/sandboxes\\\/[^\\\/]+\\\/\/, "<sandbox-copy>\/"));\n/s or die "no probesec";
$s =~ s/\| \$\{hostProbeSec\.join\("<br>"\) \|\| "none"\} \|\\n`;/| \${hostProbeSec.join("<br>") || "none"} | \${sbxProbe.join("<br>") || "none"} |\\n`;/ or die "no row";
$s =~ s/\| host probe files in <profile>\/workspace \|\\n\|---\|---\|---\|---\|---\|---\|---\|---\|\\n/| probe files on the host under <profile>\/workspace | probe files only in the sandbox private copy |\\n|---|---|---|---|---|---|---|---|---|\\n/ or die "no header";
open(F, ">", $f) or die; print F $s; close F;
