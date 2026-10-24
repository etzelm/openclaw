// usage: node outcomes.mjs <runs-dir> <label> [scenario...]
// One line per scenario, read only from the run directory: the synthetic child's own records
// (fake-claude.log events and the .user-/.context-/.init-/.argv- files it wrote), turns.log,
// turnN.err, boundary-by-turn.txt and managed-redirect.log. Main no longer logs `cli exec:`,
// so per-turn sizes and canary counts come from what the child actually received.
import fs from "node:fs";
import path from "node:path";

const [runsDir, label, ...only] = process.argv.slice(2);
const CANARIES = ["PINEAPPLE-7", "KIWI-9"];
const count = (text, needle) => text.split(needle).length - 1;
const counts = (text) => CANARIES.map((c) => count(text, c)).join(",");
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined);

console.log(
  [
    "# scenario",
    "turn exits",
    "per turn tN[spawns=<child processes> user=<delivered user-message chars>:<PINEAPPLE-7,KIWI-9 counts> ctx=<UserPromptSubmit hook-context chars>:<counts>(+conv when it carries the history-gated 'Conversation data' block) sys=<counts in initialize request + argv system prompt> profile=<stub requests> managed=<redirected managed-path fs calls>] ('nouser' = no user message reached the child, 'noctx' = no hook answer reached the child)",
    "refusal line(s) in turnN.err",
    "stored cliHistoryBoundary after each turn (state/maxSeq)",
  ].join(" | "),
);
const dirs = fs
  .readdirSync(runsDir)
  .filter((d) => d.startsWith(`${label}-`))
  .filter((d) => only.length === 0 || only.includes(d.slice(label.length + 1)))
  .sort((a, b) => {
    const order = only.length ? only : [];
    return order.indexOf(a.slice(label.length + 1)) - order.indexOf(b.slice(label.length + 1)) || a.localeCompare(b);
  });
for (const d of dirs) {
  const run = path.join(runsDir, d);
  const scen = d.slice(label.length + 1);
  const turnsLog = read(path.join(run, "turns.log")) ?? "";
  const exits = [...turnsLog.matchAll(/^turn (\d+) exit=(\d+)$/gm)].map((m) => `t${m[1]}=${m[2]}`);
  // Walk the child's log: "=== turnN" marks open a turn, JSON lines belong to the open turn.
  const perTurn = new Map();
  let current = 0;
  for (const line of (read(path.join(run, "fake-claude.log")) ?? "").split("\n")) {
    const markMatch = /^=== turn(\d+)/.exec(line);
    if (markMatch) {
      current = Number(markMatch[1]);
      perTurn.set(current, { spawns: 0, users: [], ctx: [], sys: [], profile: 0 });
      continue;
    }
    if (!line.startsWith("{") || !perTurn.has(current)) continue;
    const e = JSON.parse(line);
    const t = perTurn.get(current);
    if (e.event === "spawn") {
      t.spawns += 1;
      if (e.argvFile) t.sys.push(read(e.argvFile) ?? "");
    } else if (e.event === "initialize" && e.initFile) {
      t.sys.push(read(e.initFile) ?? "");
    } else if (e.event === "user-message-received") {
      t.users.push(read(e.promptFile) ?? "");
    } else if (e.event === "prompt-context-received") {
      t.ctx.push(read(e.contextFile) ?? "");
    } else if (e.event === "profile-request") {
      t.profile += 1;
    }
  }
  const managed = new Map();
  for (const line of (read(path.join(run, "managed-redirect.log")) ?? "").split("\n")) {
    if (!line) continue;
    const e = JSON.parse(line);
    managed.set(String(e.turn), (managed.get(String(e.turn)) ?? 0) + 1);
  }
  const turns = [...perTurn.entries()].map(([n, t]) => {
    const user = t.users.length ? t.users.map((u) => `${u.length}:${counts(u)}`).join("/") : "nouser";
    const ctx = t.ctx.length
      ? t.ctx.map((c) => `${c.length}:${counts(c)}${c.includes("Conversation data") ? "+conv" : ""}`).join("/")
      : "noctx";
    const sys = counts(t.sys.join("\n"));
    return `t${n}[spawns=${t.spawns} user=${user} ctx=${ctx} sys=${sys} profile=${t.profile} managed=${managed.get(String(n)) ?? 0}]`;
  });
  const refusals = [];
  for (const f of fs.readdirSync(run).filter((f) => /^turn\d+\.err$/.test(f)).sort()) {
    for (const line of (read(path.join(run, f)) ?? "").split("\n")) {
      if (/authority changed|history.*refused|refused/i.test(line)) {
        refusals.push(`${f.replace(".err", "")}: ${line.trim().slice(0, 220)}`);
      }
    }
  }
  const boundary = (read(path.join(run, "boundary-by-turn.txt")) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) =>
      l
        .replace(/^after turn (\d+): cliHistoryBoundary /, "t$1:")
        .replace(/"state":/, "")
        .replace(/,"maxSeq":/, "/")
        .replace(/[{}"]/g, ""),
    );
  console.log(
    [scen, exits.join(" "), turns.join(" "), refusals.length ? refusals.join(" ; ") : "none", boundary.join(" ")].join(" | "),
  );
}
