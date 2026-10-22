// Scratch: build redacted per-run evidence from ../out. Usage: node extract.mjs <outDir> <destDir>
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const [outDir, dest] = process.argv.slice(2);
mkdirSync(dest, { recursive: true });
const home = os.homedir();
const redact = (s) =>
  s
    .replaceAll(home, "~")
    .replace(/\/Users\/[A-Za-z0-9._-]+/gu, "~")
    .replace(/proof-(before|after)-token-[a-z0-9]+/gu, "<token>")
    .replace(/#token=[^\s"']+/gu, "#token=<token>")
    .replace(/\b127\.0\.0\.1\b/gu, "<loopback>")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, "<ip>")
    .replace(/\b[a-f0-9]{64}\b/gu, "<hex64>")
    .replace(/(state%3D|state=)[A-Za-z0-9%]+/gu, "$1<state>")
    .replace(/(code_challenge=)[A-Za-z0-9_-]+/gu, "$1<challenge>")
    .replace(/remotePort=\d+/gu, "remotePort=<port>")
    .replace(new RegExp(os.hostname().replace(/\./gu, "\\."), "gu"), "<host>");

const surfaces = ["model-setup-openai-device-code", "custodian", "model-setup-openrouter-oauth"];
const summary = [];
for (const arm of ["before", "after"]) {
  const transcript = readFileSync(path.join(outDir, `${arm}-transcript.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const gatewayLog = readFileSync(path.join(outDir, `${arm}-gateway.raw.log`), "utf8").split("\n");
  for (const surface of surfaces) {
    const begin = transcript.findIndex((e) => e.marker === `begin ${surface}`);
    const end = transcript.findIndex((e) => e.marker === `end ${surface}`);
    const window = transcript.slice(begin, end + 1);
    const start = window.find((e) => e.method === "openclaw.setup.auth.start" && e.dir === "ui->gw");
    const sid = start?.sessionId;
    const rpc = window.filter(
      (e) => e.marker || e.sessionId === sid || (e.method && e.method.startsWith("openclaw.setup")) || e.step || e.blockedExternal,
    );
    // Response frames carry no sessionId: keep any response whose request id belongs to this window.
    const ids = new Set(window.filter((e) => e.dir === "ui->gw").map((e) => e.id));
    const keep = window.filter((e) => rpc.includes(e) || (e.dir === "gw->ui" && ids.has(e.id)));
    writeFileSync(
      path.join(dest, `${arm}-${surface}-rpc.jsonl`),
      keep.map((e) => redact(JSON.stringify(e))).join("\n") + "\n",
    );
    // Gateway's own ws log from the UI's auth.start request to the next health marker.
    const lines = [];
    let inWindow = false;
    const startShort = start ? `id=${String(start.id).slice(0, 11)}` : "\0";
    for (const l of gatewayLog) {
      if (!inWindow && l.includes("← req openclaw.setup.auth.start") && l.includes(startShort)) inWindow = true;
      if (!inWindow) continue;
      if (l.includes("← req health")) break;
      if (/wizard\.|openclaw\.setup\./u.test(l)) lines.push(l);
    }
    writeFileSync(path.join(dest, `${arm}-${surface}-gateway-log.txt`), lines.map(redact).join("\n") + "\n");
    for (const suffix of ["", "-pending"]) {
      const f = `${arm}-${surface}${suffix}.png`;
      try {
        copyFileSync(path.join(outDir, f), path.join(dest, f));
      } catch {}
    }
    const alert = readFileSync(path.join(outDir, `${arm}-${surface}-alert.txt`), "utf8");
    writeFileSync(path.join(dest, `${arm}-${surface}-alert.txt`), redact(alert));
    const cancel = readFileSync(path.join(outDir, `${arm}-${surface}-wizard-cancel.txt`), "utf8");
    writeFileSync(path.join(dest, `${arm}-${surface}-wizard-cancel.txt`), redact(cancel));
    const settled = keep.find((e) => e.dir === "gw->ui" && e.method === "wizard.next" && e.done === true);
    const text = window.find((e) => e.step === `${surface}: rendered alert`)?.text;
    summary.push({ arm, surface, sessionId: sid, settledWizardNext: settled ?? null, renderedAlert: text });
  }
  for (const f of readdirSync(outDir)) {
    if (f === `${arm}-custodian-needs-sign-in.png`) copyFileSync(path.join(outDir, f), path.join(dest, f));
  }
  const head = gatewayLog[0];
  writeFileSync(path.join(dest, `${arm}-gateway-command.txt`), redact(head) + "\n");
}
writeFileSync(path.join(dest, "summary.json"), redact(JSON.stringify(summary, null, 2)) + "\n");
console.log(redact(JSON.stringify(summary, null, 2)));
