# Time N random 4 KiB preads (seeded offsets, page aligned) over a file. Usage: read-random.py <file> [n] [seed]
import os, random, sys, time
p = sys.argv[1]; n = int(sys.argv[2]) if len(sys.argv) > 2 else 20000; seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
size = os.path.getsize(p); pages = size // 4096
rnd = random.Random(seed); offs = [rnd.randrange(pages) * 4096 for _ in range(n)]
fd = os.open(p, os.O_RDONLY)
t = time.perf_counter()
for o in offs: os.pread(fd, 4096, o)
s = time.perf_counter() - t; os.close(fd)
print(f"{p.split('/')[-1]} random_4k_preads={n} total_s={s:.3f} us_per_read={s/n*1e6:.1f}")
