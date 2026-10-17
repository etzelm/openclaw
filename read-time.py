# Time a full sequential read of a file (cat > /dev/null equivalent). Prints seconds and MB/s.
import sys, time
p = sys.argv[1]; n = 0
t = time.perf_counter()
with open(p, "rb", buffering=0) as f:
    while True:
        b = f.read(8 << 20)
        if not b: break
        n += len(b)
s = time.perf_counter() - t
print(f"{p.split('/')[-1]} bytes={n} read_s={s:.3f} MB_per_s={n/s/1e6:.0f}")
