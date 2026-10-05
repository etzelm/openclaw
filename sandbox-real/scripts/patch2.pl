undef $/;
my $d = "$ENV{HOME}/Library/Caches/pr165112-sandbox/h";
open(F, "<", "$d/harness.mjs") or die; my $s = <F>; close F;
my $clean = <<'JS';
} else if (cmd === "controls") {
  const sweep = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) sweep(p);
      else if (e.name.startsWith("pr165112-")) fs.unlinkSync(p);
    }
  };
  sweep(ROOT);
JS
$s =~ s/\} else if \(cmd === "controls"\) \{\n/$clean/ or die "no controls";
open(F, ">", "$d/harness.mjs") or die; print F $s; close F;
open(F, "<", "$d/summarize.mjs") or die; $s = <F>; close F;
$s =~ s/const last = rows.at\(-1\);\nlet body;\ntry \{ body = typeof last.body === "string" \? JSON.parse\(last.body\) : last.body; \} catch \(e\) \{ console.log\("last body unparsable:", e.message\); process.exit\(1\); \}\n/const parse = (r) => { try { return typeof r.body === "string" ? JSON.parse(r.body) : r.body; } catch { return {}; } };\nconst body = { input: rows.flatMap((r) => parse(r).input ?? []) };\n/ or die "no summ";
$s =~ s/const first = \(\(\) => \{.*?\}\)\(\);\n/const first = parse(rows[0]);\n/s or die "no first";
open(F, ">", "$d/summarize.mjs") or die; print F $s; close F;
