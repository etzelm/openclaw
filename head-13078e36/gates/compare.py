# A refused turn never delivers a user message, so the old promptChars/useResume for it (read from the removed log line) has no counterpart; only the REFUSED flag is compared for such turns.
# Compare r14 outcomes-after.txt (old per-turn column promptChars/historyPrompt/useResume) with the
# r15 outcomes2 table (chars/sessionMode). Equivalent when: exit codes equal, per-turn chars equal and
# useResume == (sessionMode == resume) and REFUSED flags equal, canary column equal, boundary equal, stub count equal.
import sys
def load(p): return {c[0]: c for c in ([x.strip() for x in l.rstrip("\n").split("|")] for l in open(p) if not l.startswith("#"))}
old = load(sys.argv[1]); new = load(sys.argv[2])
import re as _re
def normctx(col): return _re.sub(r"\+ctx\d+:", "+ctx:", col)
def turns_old(col):
    out=[]
    for t in col.split():
        p=t.split("/"); r="REFUSED" in t; out.append(("-" if r else p[0], None if r else (p[2]=="true" if p[2] in ("true","false") else None), r))
    return out
def turns_new(col):
    out=[]
    for t in col.split():
        p=t.split("/"); r="REFUSED" in t; out.append(("-" if r else p[0], None if r else (p[1]=="resume" if p[1] in ("fresh","resume") else None), r))
    return out
same=0; diff=[]; ctxonly=[]
for s,o in sorted(old.items()):
    n=new.get(s)
    if not n: diff.append((s,"missing in new")); continue
    checks = [("exit",o[1].strip()==n[1].strip()),("turns",turns_old(o[2])==turns_new(n[2])),("canary",o[3]==n[3]),("canary-ctx-normalized",normctx(o[3])==normctx(n[3])),("boundary",o[4].strip()==n[4].strip()),("stub",o[5].strip()==n[5].strip())]
    bad=[c for c,ok in checks if not ok]
    if bad==["canary"]: same+=1; ctxonly.append(s); continue
    if bad: diff.append((s,bad, o, n))
    else: same+=1
print("identical after normalizing UserPromptSubmit context byte counts only:", ctxonly)
print(f"scenarios in old: {len(old)}, new: {len(new)}, identical: {same}, different: {len(diff)}")
for d in diff: print(d)
for s in sorted(set(new)-set(old)): print("only in new:", s)
