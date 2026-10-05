import json,collections,os,sys
R=os.path.expanduser(sys.argv[1])
turn=None; c=collections.Counter(); tot=collections.Counter()
for line in open(R):
    if line.startswith('==='): turn=line.strip(); continue
    try: d=json.loads(line)
    except: continue
    if d.get('event')!='security-lookup': continue
    tot[(turn,d['kind'])]+=1
    st=[f for f in d.get('stack',[]) if 'node:' not in f and 'security-shim' not in f]
    key=' <- '.join(f.split(' (')[0] for f in st[:int(sys.argv[2]) if len(sys.argv)>2 else 7])
    c[(turn[:12] if turn else '',key)]+=1
for t,n in tot.items(): print(n,t)
for (t,k),n in sorted(c.items(), key=lambda x:-x[1])[:40]: print(n, t, k)
