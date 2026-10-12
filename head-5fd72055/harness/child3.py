import json,re,sys
# usage: child3.py <fake-claude.log> <first pid>: records from the profile request before that pid's spawn onward, path fields omitted.
log,pid=sys.argv[1],int(sys.argv[2])
keep={"profile-request","spawn","initialize","hook-ran","user-message-received","prompt-context-received"}
rows=[json.loads(l) for l in open(log) if l.strip().startswith("{")]
start=next(i for i,r in enumerate(rows) if r.get("pid")==pid)
while start>0 and rows[start-1].get("event")=="profile-request": start-=1
for r in rows[start:]:
    if r.get("event") not in keep: continue
    for k in list(r):
        if k=="configDir" or k.endswith("File"): del r[k]
    print(json.dumps(r,separators=(",",":")))
