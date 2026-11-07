# usage: python3 -I detach.py <logfile> <cmd...> : run cmd in a new session, detached from the caller
import os, sys
log, cmd = sys.argv[1], sys.argv[2:]
if os.fork(): sys.exit(0)
os.setsid()
if os.fork(): os._exit(0)
fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(fd, 1); os.dup2(fd, 2)
nul = os.open(os.devnull, os.O_RDONLY); os.dup2(nul, 0)
os.execvp(cmd[0], cmd)
