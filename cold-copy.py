# Copy src to dst writing with macOS F_NOCACHE (fcntl 48) set on the destination fd, so the copy's pages
# are not left in the unified buffer cache. Usage: cold-copy.py <src> <dst> [--cached]
import fcntl, os, sys
src, dst = sys.argv[1], sys.argv[2]
nocache = "--cached" not in sys.argv
fd_out = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
if nocache:
    fcntl.fcntl(fd_out, 48, 1)
with open(src, "rb", buffering=0) as f:
    while True:
        b = f.read(8 << 20)
        if not b:
            break
        os.write(fd_out, b)
os.fsync(fd_out)
os.close(fd_out)
