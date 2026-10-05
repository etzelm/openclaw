
### pre-subdir-none

- tools offered to the model: apply_patch, edit, exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image, write
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/state/sandboxes/workspace-4ad94e17ab6e3541c8f23a3122b66112. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/state/sandboxes/workspace-4ad94e17ab6e3541c8f23a3122b66112`
  - `Agent workspace access: none`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: not run
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-control.txt." }` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/pr165112-control.txt." }` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/pr165112-control.txt. Use exec to access this mount; file tools require a ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/dev/SOUL.md. Use exec to access this mount; file tools require a host-back` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | write reported OK | `Successfully wrote 10 bytes to /workspace/pr165112-own-write.txt` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | own-write  | `own-write ` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/pr165112-write-probe-rel.txt. Use exec to access this mount; file tools req` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | write reported OK | `Successfully wrote 2 bytes to /workspace/dev/pr165112-write-probe-ws.txt` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /agent/dev/pr165112-write-probe-agent.txt. Use exec to access this mount; file t` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bi` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | not found | `/workspace ---mounts virtiofs0 /workspace virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 ---ls ls: /agent: No such file or directory /: total 56 dr` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | not found | `rc=1 cat: can't open 'pr165112-control.txt': No such file or directory` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | exec rc=0 | `rc=0` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `rc=0 rc=1 /bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory` |

### pre-subdir-ro

- tools offered to the model: exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/state/sandboxes/workspace-53a435b8ecd1c9f7efe0d853e2ddc11d. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/state/sandboxes/workspace-53a435b8ecd1c9f7efe0d853e2ddc11d`
  - `Agent workspace access: ro (mounted at /agent)`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: not run
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-control.txt." }` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/pr165112-control.txt." }` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | CONTROL-ROOT  | `CONTROL-ROOT ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona ` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | tool not offered | `Tool write not found` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-own-write.txt." }` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | tool not offered | `Tool write not found` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | /workspace ---mounts virtiofs0 /agent virtiofs ro,nosuid,nodev,relatim | `/workspace ---mounts virtiofs0 /agent virtiofs ro,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 virtiofs0 /workspace virtiofs ro,nosuid,nodev,relatime,ignore_` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | not found | `cat: can't open 'pr165112-control.txt': No such file or directory rc=1` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona rc=0` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | not found | `touch: /workspace/dev/pr165112-exec-touch-ws.txt: No such file or directory rc=1` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | DENIED (EROFS) | `rc=1 touch: /agent/dev/pr165112-exec-touch-agent.txt: Read-only file system` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `rc=1 /bin/sh: can't create /workspace/dev/SOUL.md: nonexistent directory /bin/sh: can't create /agent/dev/SOUL.md: Read-only file system rc=1` |

### pre-subdir-rw

- tools offered to the model: apply_patch, edit, exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image, write
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/workspace. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/workspace`
  - `Agent workspace access: rw`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: not run
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / b70f0b5726905841ff36d473a6442a67d144ce29c40b8d8719d991d93142508d

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | CONTROL-ROOT  | `CONTROL-ROOT ` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | CONTROL-ROOT  | `CONTROL-ROOT ` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/pr165112-control.txt. Use exec to access this mount; file tools require a ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona ` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/dev/SOUL.md. Use exec to access this mount; file tools require a host-back` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | write reported OK | `Successfully wrote 10 bytes to /workspace/pr165112-own-write.txt` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | own-write  | `own-write ` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/pr165112-write-probe-rel.txt. Use exec to access this mount; file tools req` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | write reported OK | `Successfully wrote 2 bytes to /workspace/dev/pr165112-write-probe-ws.txt` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /agent/dev/pr165112-write-probe-agent.txt. Use exec to access this mount; file t` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bi` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | not found | `/workspace ---mounts virtiofs0 /workspace virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 ---ls ls: /agent: No such file or directory /: total 56 dr` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | exec rc=0 | `CONTROL-ROOT rc=0` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona rc=0` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `rc=1 cat: can't open '/agent/dev/SOUL.md': No such file or directory` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | exec rc=0 | `rc=0` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `/bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory rc=0 rc=1` |

### pre-neither-none

- tools offered to the model: apply_patch, edit, exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image, write
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/state/sandboxes/workspace-14035f3d94de898870b2d27139bcef91. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/state/sandboxes/workspace-14035f3d94de898870b2d27139bcef91`
  - `Agent workspace access: none`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: not run
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-control.txt." }` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/pr165112-control.txt." }` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/pr165112-control.txt. Use exec to access this mount; file tools require a ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/dev/SOUL.md. Use exec to access this mount; file tools require a host-back` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | write reported OK | `Successfully wrote 10 bytes to /workspace/pr165112-own-write.txt` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | own-write  | `own-write ` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/pr165112-write-probe-rel.txt. Use exec to access this mount; file tools req` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | write reported OK | `Successfully wrote 2 bytes to /workspace/dev/pr165112-write-probe-ws.txt` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /agent/dev/pr165112-write-probe-agent.txt. Use exec to access this mount; file t` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bi` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | not found | `/workspace ---mounts virtiofs0 /workspace virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 ---ls ls: /agent: No such file or directory /: total 56 dr` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | not found | `cat: can't open 'pr165112-control.txt': No such file or directory rc=1` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | exec rc=0 | `rc=0` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `/bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory rc=0 rc=1` |

### pre-neither-ro

- tools offered to the model: exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/state/sandboxes/workspace-6bbc6a46e9c326dd3fcfdeaf16ce8e4f. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/state/sandboxes/workspace-6bbc6a46e9c326dd3fcfdeaf16ce8e4f`
  - `Agent workspace access: ro (mounted at /agent)`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: not run
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-control.txt." }` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/pr165112-control.txt." }` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | CONTROL-ROOT  | `CONTROL-ROOT ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona ` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | tool not offered | `Tool write not found` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-own-write.txt." }` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | tool not offered | `Tool write not found` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | /workspace ---mounts virtiofs0 /agent virtiofs ro,nosuid,nodev,relatim | `/workspace ---mounts virtiofs0 /agent virtiofs ro,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 virtiofs0 /workspace virtiofs ro,nosuid,nodev,relatime,ignore_` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | not found | `cat: can't open 'pr165112-control.txt': No such file or directory rc=1` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona rc=0` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | not found | `touch: /workspace/dev/pr165112-exec-touch-ws.txt: No such file or directory rc=1` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | DENIED (EROFS) | `touch: /agent/dev/pr165112-exec-touch-agent.txt: Read-only file system rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `/bin/sh: can't create /workspace/dev/SOUL.md: nonexistent directory /bin/sh: can't create /agent/dev/SOUL.md: Read-only file system rc=1 rc=1` |

### pre-neither-rw

- tools offered to the model: apply_patch, edit, exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image, write
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/workspace. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/workspace`
  - `Agent workspace access: rw`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: not run
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / b70f0b5726905841ff36d473a6442a67d144ce29c40b8d8719d991d93142508d

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | CONTROL-ROOT  | `CONTROL-ROOT ` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | CONTROL-ROOT  | `CONTROL-ROOT ` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/pr165112-control.txt. Use exec to access this mount; file tools require a ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona ` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/dev/SOUL.md. Use exec to access this mount; file tools require a host-back` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | write reported OK | `Successfully wrote 10 bytes to /workspace/pr165112-own-write.txt` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | own-write  | `own-write ` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/pr165112-write-probe-rel.txt. Use exec to access this mount; file tools req` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | write reported OK | `Successfully wrote 2 bytes to /workspace/dev/pr165112-write-probe-ws.txt` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /agent/dev/pr165112-write-probe-agent.txt. Use exec to access this mount; file t` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bi` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | not found | `/workspace ---mounts virtiofs0 /workspace virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 ---ls ls: /agent: No such file or directory /: total 56 dr` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | exec rc=0 | `CONTROL-ROOT rc=0` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona rc=0` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | exec rc=0 | `rc=0` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `rc=0 rc=1 /bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory` |

### pre-rootonly-none

- tools offered to the model: apply_patch, edit, exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image, write
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/state/sandboxes/workspace-b669e0d2e49c2e9859e9eb57c4b86290. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/state/sandboxes/workspace-b669e0d2e49c2e9859e9eb57c4b86290`
  - `Agent workspace access: none`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: not run
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-control.txt." }` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/pr165112-control.txt." }` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/pr165112-control.txt. Use exec to access this mount; file tools require a ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/dev/SOUL.md. Use exec to access this mount; file tools require a host-back` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | write reported OK | `Successfully wrote 10 bytes to /workspace/pr165112-own-write.txt` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | own-write  | `own-write ` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/pr165112-write-probe-rel.txt. Use exec to access this mount; file tools req` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | write reported OK | `Successfully wrote 2 bytes to /workspace/dev/pr165112-write-probe-ws.txt` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /agent/dev/pr165112-write-probe-agent.txt. Use exec to access this mount; file t` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bi` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | not found | `/workspace ---mounts virtiofs0 /workspace virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 ---ls ls: /agent: No such file or directory /: total 56 dr` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | not found | `cat: can't open 'pr165112-control.txt': No such file or directory rc=1` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `rc=1 touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | exec rc=0 | `rc=0` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `/bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory rc=0 rc=1` |

### pre-rootonly-ro

- tools offered to the model: exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/state/sandboxes/workspace-a8c77a34565880bddfd75cf1b2ad5d0b. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/state/sandboxes/workspace-a8c77a34565880bddfd75cf1b2ad5d0b`
  - `Agent workspace access: ro (mounted at /agent)`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: not run
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-control.txt." }` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/pr165112-control.txt." }` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | CONTROL-ROOT  | `CONTROL-ROOT ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona ` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | tool not offered | `Tool write not found` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-own-write.txt." }` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | tool not offered | `Tool write not found` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | /workspace ---mounts virtiofs0 /agent virtiofs ro,nosuid,nodev,relatim | `/workspace ---mounts virtiofs0 /agent virtiofs ro,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 virtiofs0 /workspace virtiofs ro,nosuid,nodev,relatime,ignore_` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | not found | `cat: can't open 'pr165112-control.txt': No such file or directory rc=1` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona rc=0` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | not found | `touch: /workspace/dev/pr165112-exec-touch-ws.txt: No such file or directory rc=1` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | DENIED (EROFS) | `touch: /agent/dev/pr165112-exec-touch-agent.txt: Read-only file system rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `rc=1 rc=1 /bin/sh: can't create /workspace/dev/SOUL.md: nonexistent directory /bin/sh: can't create /agent/dev/SOUL.md: Read-only file system` |

### pre-rootonly-rw

- tools offered to the model: apply_patch, edit, exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image, write
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/workspace. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/workspace`
  - `Agent workspace access: rw`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: not run
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / b70f0b5726905841ff36d473a6442a67d144ce29c40b8d8719d991d93142508d

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | CONTROL-ROOT  | `CONTROL-ROOT ` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | CONTROL-ROOT  | `CONTROL-ROOT ` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/pr165112-control.txt. Use exec to access this mount; file tools require a ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona ` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/dev/SOUL.md. Use exec to access this mount; file tools require a host-back` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | write reported OK | `Successfully wrote 10 bytes to /workspace/pr165112-own-write.txt` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | own-write  | `own-write ` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/pr165112-write-probe-rel.txt. Use exec to access this mount; file tools req` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | write reported OK | `Successfully wrote 2 bytes to /workspace/dev/pr165112-write-probe-ws.txt` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /agent/dev/pr165112-write-probe-agent.txt. Use exec to access this mount; file t` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bi` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | not found | `/workspace ---mounts virtiofs0 /workspace virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 ---ls ls: /agent: No such file or directory /: total 56 dr` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | exec rc=0 | `CONTROL-ROOT rc=0` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona rc=0` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `rc=1 touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | exec rc=0 | `rc=0` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `/bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory rc=0 rc=1` |

### post-subdir-none

- tools offered to the model: apply_patch, edit, exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image, write
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/state/sandboxes/workspace-f80ff1d5dbaf7b1baccb06bbf51241da. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/state/sandboxes/workspace-f80ff1d5dbaf7b1baccb06bbf51241da`
  - `Agent workspace access: none`
  - `## <profile>/state/sandboxes/workspace-f80ff1d5dbaf7b1baccb06bbf51241da/AGENTS.md`
- Doctor: "workspace": "<profile>/workspace/main"
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-control.txt." }` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/pr165112-control.txt." }` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/pr165112-control.txt. Use exec to access this mount; file tools require a ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/dev/SOUL.md. Use exec to access this mount; file tools require a host-back` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | write reported OK | `Successfully wrote 10 bytes to /workspace/pr165112-own-write.txt` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | own-write  | `own-write ` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/pr165112-write-probe-rel.txt. Use exec to access this mount; file tools req` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | write reported OK | `Successfully wrote 2 bytes to /workspace/dev/pr165112-write-probe-ws.txt` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /agent/dev/pr165112-write-probe-agent.txt. Use exec to access this mount; file t` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bi` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | not found | `/workspace ---mounts virtiofs0 /workspace virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 ---ls ls: /agent: No such file or directory /: total 56 dr` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | not found | `cat: can't open 'pr165112-control.txt': No such file or directory rc=1` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | exec rc=0 | `rc=0` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `rc=0 rc=1 /bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory` |

### post-subdir-ro

- tools offered to the model: exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/state/sandboxes/workspace-a0f70d2be0f49cd599bd2a0974f16b6f. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/state/sandboxes/workspace-a0f70d2be0f49cd599bd2a0974f16b6f`
  - `Agent workspace access: ro (mounted at /agent)`
  - `## <profile>/state/sandboxes/workspace-a0f70d2be0f49cd599bd2a0974f16b6f/AGENTS.md`
- Doctor: "workspace": "<profile>/workspace/main"
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-control.txt." }` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/pr165112-control.txt." }` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | CONTROL-MAIN  | `CONTROL-MAIN ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /agent/dev/SOUL.md." }` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | tool not offered | `Tool write not found` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-own-write.txt." }` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | tool not offered | `Tool write not found` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | /workspace ---mounts virtiofs0 /agent virtiofs ro,nosuid,nodev,relatim | `/workspace ---mounts virtiofs0 /agent virtiofs ro,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 virtiofs0 /workspace virtiofs ro,nosuid,nodev,relatime,ignore_` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | not found | `cat: can't open 'pr165112-control.txt': No such file or directory rc=1` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | not found | `touch: /workspace/dev/pr165112-exec-touch-ws.txt: No such file or directory rc=1` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `rc=1 /bin/sh: can't create /workspace/dev/SOUL.md: nonexistent directory /bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory rc=1` |

### post-subdir-rw

- tools offered to the model: apply_patch, edit, exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image, write
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/workspace/main. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/workspace/main`
  - `Agent workspace access: rw`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: "workspace": "<profile>/workspace/main"
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | CONTROL-MAIN  | `CONTROL-MAIN ` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | CONTROL-MAIN  | `CONTROL-MAIN ` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/pr165112-control.txt. Use exec to access this mount; file tools require a ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/dev/SOUL.md. Use exec to access this mount; file tools require a host-back` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | write reported OK | `Successfully wrote 10 bytes to /workspace/pr165112-own-write.txt` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | own-write  | `own-write ` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/pr165112-write-probe-rel.txt. Use exec to access this mount; file tools req` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | write reported OK | `Successfully wrote 2 bytes to /workspace/dev/pr165112-write-probe-ws.txt` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /agent/dev/pr165112-write-probe-agent.txt. Use exec to access this mount; file t` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bi` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | not found | `/workspace ---mounts virtiofs0 /workspace virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 ---ls ls: /agent: No such file or directory /: total 56 dr` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | exec rc=0 | `CONTROL-MAIN rc=0` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `rc=1 cat: can't open '../dev/SOUL.md': No such file or directory` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | exec rc=0 | `rc=0` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `/bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory rc=0 rc=1` |

### post-neither-none

- tools offered to the model: apply_patch, edit, exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image, write
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/state/sandboxes/workspace-e19628f00e22927d8874d3d351b52063. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/state/sandboxes/workspace-e19628f00e22927d8874d3d351b52063`
  - `Agent workspace access: none`
  - `## <profile>/state/sandboxes/workspace-e19628f00e22927d8874d3d351b52063/AGENTS.md`
- Doctor: "workspace": "<profile>/workspace/main"
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-control.txt." }` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/pr165112-control.txt." }` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/pr165112-control.txt. Use exec to access this mount; file tools require a ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/dev/SOUL.md. Use exec to access this mount; file tools require a host-back` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | write reported OK | `Successfully wrote 10 bytes to /workspace/pr165112-own-write.txt` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | own-write  | `own-write ` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/pr165112-write-probe-rel.txt. Use exec to access this mount; file tools req` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | write reported OK | `Successfully wrote 2 bytes to /workspace/dev/pr165112-write-probe-ws.txt` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /agent/dev/pr165112-write-probe-agent.txt. Use exec to access this mount; file t` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bi` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | not found | `/workspace ---mounts virtiofs0 /workspace virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 ---ls ls: /agent: No such file or directory /: total 56 dr` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | not found | `cat: can't open 'pr165112-control.txt': No such file or directory rc=1` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | exec rc=0 | `rc=0` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `/bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory rc=0 rc=1` |

### post-neither-ro

- tools offered to the model: exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/state/sandboxes/workspace-c45c3f60b07e273fec6af153e5a9cbaf. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/state/sandboxes/workspace-c45c3f60b07e273fec6af153e5a9cbaf`
  - `Agent workspace access: ro (mounted at /agent)`
  - `## <profile>/state/sandboxes/workspace-c45c3f60b07e273fec6af153e5a9cbaf/AGENTS.md`
- Doctor: "workspace": "<profile>/workspace/main"
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-control.txt." }` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/pr165112-control.txt." }` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | CONTROL-MAIN  | `CONTROL-MAIN ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /agent/dev/SOUL.md." }` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | tool not offered | `Tool write not found` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-own-write.txt." }` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | tool not offered | `Tool write not found` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | /workspace ---mounts virtiofs0 /agent virtiofs ro,nosuid,nodev,relatim | `/workspace ---mounts virtiofs0 /agent virtiofs ro,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 virtiofs0 /workspace virtiofs ro,nosuid,nodev,relatime,ignore_` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | not found | `cat: can't open 'pr165112-control.txt': No such file or directory rc=1` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | not found | `touch: /workspace/dev/pr165112-exec-touch-ws.txt: No such file or directory rc=1` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `/bin/sh: can't create /workspace/dev/SOUL.md: nonexistent directory /bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory rc=1 rc=1` |

### post-neither-rw

- tools offered to the model: apply_patch, edit, exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image, write
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/workspace/main. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/workspace/main`
  - `Agent workspace access: rw`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: "workspace": "<profile>/workspace/main"
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | CONTROL-MAIN  | `CONTROL-MAIN ` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | CONTROL-MAIN  | `CONTROL-MAIN ` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/pr165112-control.txt. Use exec to access this mount; file tools require a ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/dev/SOUL.md. Use exec to access this mount; file tools require a host-back` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | write reported OK | `Successfully wrote 10 bytes to /workspace/pr165112-own-write.txt` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | own-write  | `own-write ` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/pr165112-write-probe-rel.txt. Use exec to access this mount; file tools req` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | write reported OK | `Successfully wrote 2 bytes to /workspace/dev/pr165112-write-probe-ws.txt` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /agent/dev/pr165112-write-probe-agent.txt. Use exec to access this mount; file t` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bi` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | not found | `/workspace ---mounts virtiofs0 /workspace virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 ---ls ls: /agent: No such file or directory /: total 56 dr` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | exec rc=0 | `CONTROL-MAIN rc=0` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | exec rc=0 | `rc=0` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `rc=0 rc=1 /bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory` |

### post-rootonly-none

- tools offered to the model: apply_patch, edit, exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image, write
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/state/sandboxes/workspace-2a442460241f2129719da73c29e8db92. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/state/sandboxes/workspace-2a442460241f2129719da73c29e8db92`
  - `Agent workspace access: none`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: no pin written (warning only)
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-control.txt." }` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/pr165112-control.txt." }` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/pr165112-control.txt. Use exec to access this mount; file tools require a ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/dev/SOUL.md. Use exec to access this mount; file tools require a host-back` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | write reported OK | `Successfully wrote 10 bytes to /workspace/pr165112-own-write.txt` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | own-write  | `own-write ` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/pr165112-write-probe-rel.txt. Use exec to access this mount; file tools req` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | write reported OK | `Successfully wrote 2 bytes to /workspace/dev/pr165112-write-probe-ws.txt` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /agent/dev/pr165112-write-probe-agent.txt. Use exec to access this mount; file t` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bi` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | not found | `/workspace ---mounts virtiofs0 /workspace virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 ---ls ls: /agent: No such file or directory /: total 56 dr` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | not found | `cat: can't open 'pr165112-control.txt': No such file or directory rc=1` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | exec rc=0 | `rc=0` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `rc=0 rc=1 /bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory` |

### post-rootonly-ro

- tools offered to the model: exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/state/sandboxes/workspace-c27e7700fc1e66472bc23256de5fd63f. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/state/sandboxes/workspace-c27e7700fc1e66472bc23256de5fd63f`
  - `Agent workspace access: ro (mounted at /agent)`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: no pin written (warning only)
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-control.txt." }` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/pr165112-control.txt." }` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | CONTROL-ROOT  | `CONTROL-ROOT ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: /workspace/dev/SOUL.md." }` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona ` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | tool not offered | `Tool write not found` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | not found | `{ "status": "error", "tool": "read", "error": "File not found: pr165112-own-write.txt." }` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | tool not offered | `Tool write not found` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | tool not offered | `Tool write not found` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | /workspace ---mounts virtiofs0 /agent virtiofs ro,nosuid,nodev,relatim | `/workspace ---mounts virtiofs0 /agent virtiofs ro,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 virtiofs0 /workspace virtiofs ro,nosuid,nodev,relatime,ignore_` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | not found | `cat: can't open 'pr165112-control.txt': No such file or directory rc=1` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `rc=1 cat: can't open '../dev/SOUL.md': No such file or directory` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/workspace/dev/SOUL.md': No such file or directory rc=1` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona rc=0` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | not found | `touch: /workspace/dev/pr165112-exec-touch-ws.txt: No such file or directory rc=1` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | DENIED (EROFS) | `touch: /agent/dev/pr165112-exec-touch-agent.txt: Read-only file system rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `/bin/sh: can't create /workspace/dev/SOUL.md: nonexistent directory /bin/sh: can't create /agent/dev/SOUL.md: Read-only file system rc=1 rc=1` |

### post-rootonly-rw

- tools offered to the model: apply_patch, edit, exec, ls, process, read, sessions_yield, tool_call, tool_describe, tool_search, view_image, write
- provider-visible lines: 
  - `Working directory: /workspace`
  - `File tools use host workspace <profile>/workspace. exec uses container /workspace or relative workdir paths; never host paths. Prefer relative paths for both.`
  - `Sandbox container workdir: /workspace`
  - `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): <profile>/workspace`
  - `Agent workspace access: rw`
  - `## <profile>/workspace/main/AGENTS.md`
- Doctor: no pin written (warning only)
- host sha256 before/after: f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6 / b70f0b5726905841ff36d473a6442a67d144ce29c40b8d8719d991d93142508d

| # | tool | args | outcome | raw (first 160 chars) |
|---|---|---|---|---|
| 1 | read | `{"path":"pr165112-control.txt"}` | CONTROL-ROOT  | `CONTROL-ROOT ` |
| 2 | read | `{"path":"/workspace/pr165112-control.txt"}` | CONTROL-ROOT  | `CONTROL-ROOT ` |
| 3 | read | `{"path":"/agent/pr165112-control.txt"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/pr165112-control.txt. Use exec to access this mount; file tools require a ` |
| 4 | read | `{"path":"../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bin` |
| 5 | read | `{"path":"/workspace/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /workspace/../dev/SOUL.md. Use exec to access this mount; file tools require a ho` |
| 6 | read | `{"path":"/agent/../dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/../dev/SOUL.md. Use exec to access this mount; file tools require a host-b` |
| 7 | read | `{"path":"/workspace/dev/SOUL.md"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona ` |
| 8 | read | `{"path":"/agent/dev/SOUL.md"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "read", "error": "Sandbox path is container-only: /agent/dev/SOUL.md. Use exec to access this mount; file tools require a host-back` |
| 9 | write | `{"path":"pr165112-own-write.txt","content":"own-write\n"}` | write reported OK | `Successfully wrote 10 bytes to /workspace/pr165112-own-write.txt` |
| 10 | read | `{"path":"pr165112-own-write.txt"}` | own-write  | `own-write ` |
| 11 | write | `{"path":"../dev/pr165112-write-probe-rel.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/pr165112-write-probe-rel.txt. Use exec to access this mount; file tools req` |
| 12 | write | `{"path":"/workspace/dev/pr165112-write-probe-ws.txt","content":"x\n"}` | write reported OK | `Successfully wrote 2 bytes to /workspace/dev/pr165112-write-probe-ws.txt` |
| 13 | write | `{"path":"/agent/dev/pr165112-write-probe-agent.txt","content":"x\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /agent/dev/pr165112-write-probe-agent.txt. Use exec to access this mount; file t` |
| 14 | write | `{"path":"../dev/SOUL.md","content":"TAMPERED-BY-WRITE-TOOL\n"}` | DENIED (bridge: container-only path) | `{ "status": "error", "tool": "write", "error": "Sandbox path is container-only: /dev/SOUL.md. Use exec to access this mount; file tools require a host-backed bi` |
| 15 | exec | `{"command":"pwd; echo ---mounts; grep -E ' /(workspace/agent) ' /proc/mounts; echo ---ls; ls -la / /workspace ` | not found | `/workspace ---mounts virtiofs0 /workspace virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0 ---ls ls: /agent: No such file or directory /: total 56 dr` |
| 16 | exec | `{"command":"cat pr165112-control.txt; echo rc=$?"}` | exec rc=0 | `CONTROL-ROOT rc=0` |
| 17 | exec | `{"command":"cat ../dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '../dev/SOUL.md': No such file or directory rc=1` |
| 18 | exec | `{"command":"cat /workspace/dev/SOUL.md; echo rc=$?"}` | READ sibling marker | `PR165112-DEV-SOUL-MARKER sibling agent persona rc=0` |
| 19 | exec | `{"command":"cat /agent/dev/SOUL.md; echo rc=$?"}` | not found | `cat: can't open '/agent/dev/SOUL.md': No such file or directory rc=1` |
| 20 | exec | `{"command":"touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?"}` | DENIED (EACCES) | `touch: ../dev/pr165112-exec-touch-rel.txt: Permission denied rc=1` |
| 21 | exec | `{"command":"touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?"}` | exec rc=0 | `rc=0` |
| 22 | exec | `{"command":"touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?"}` | not found | `touch: /agent/dev/pr165112-exec-touch-agent.txt: No such file or directory rc=1` |
| 23 | exec | `{"command":"echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; e` | not found | `rc=0 rc=1 /bin/sh: can't create /agent/dev/SOUL.md: nonexistent directory` |
