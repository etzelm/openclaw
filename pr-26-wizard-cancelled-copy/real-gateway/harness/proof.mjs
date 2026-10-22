// Scratch proof driver (not committed). Usage, from the arm checkout root:
//   node .proof-harness/proof.mjs <arm> <port> <outDir> [recon]
// Starts this checkout's built Gateway (`openclaw gateway run`) with an isolated HOME and
// profile, drives the Control UI it serves in headless Chromium, and cancels each admitted
// provider sign-in from a second client (`openclaw gateway call wizard.cancel`).
import { spawn, execFile } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const run = promisify(execFile);
const [arm, portArg, outDir, mode] = process.argv.slice(2);
const port = Number(portArg);
const token = `proof-${arm}-token-${Math.random().toString(36).slice(2, 10)}`;
const profile = `pr179996-${arm}`;
const root = process.cwd();
const home = path.resolve(root, "..", `home-${arm}`);
const stateDir = path.join(home, `.openclaw-${profile}`);
mkdirSync(outDir, { recursive: true });
rmSync(home, { recursive: true, force: true });
mkdirSync(stateDir, { recursive: true });
writeFileSync(
  path.join(stateDir, "openclaw.json"),
  JSON.stringify(
    {
      gateway: {
        mode: "local",
        port,
        bind: "loopback",
        auth: { mode: "token", token },
        controlUi: { enabled: true },
      },
    },
    null,
    2,
  ),
);
const env = {
  HOME: home,
  PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  LANG: "en_US.UTF-8",
  TMPDIR: process.env.TMPDIR ?? "/tmp",
};
const t0 = Date.now();
const transcriptPath = path.join(outDir, `${arm}-transcript.jsonl`);
writeFileSync(transcriptPath, "");
const note = (entry) => {
  const line = { ms: Date.now() - t0, ...entry };
  appendFileSync(transcriptPath, JSON.stringify(line) + "\n");
  console.log(JSON.stringify(line));
};

const cli = async (args) => {
  try {
    const r = await run(process.execPath, ["openclaw.mjs", "--profile", profile, "--no-color", ...args], {
      cwd: root,
      env,
      maxBuffer: 16 << 20,
      timeout: 120_000,
    });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error) };
  }
};

const gatewayArgv = [
  "openclaw.mjs",
  "--profile",
  profile,
  "gateway",
  "run",
  "--port",
  String(port),
  "--bind",
  "loopback",
  "--auth",
  "token",
  "--allow-unconfigured",
  "--verbose",
  "--ws-log",
  "full",
];
const gatewayLog = path.join(outDir, `${arm}-gateway.raw.log`);
writeFileSync(gatewayLog, `$ node ${gatewayArgv.join(" ")}\n`);
const gateway = spawn(process.execPath, gatewayArgv, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let gatewayText = "";
for (const stream of [gateway.stdout, gateway.stderr]) {
  stream.on("data", (chunk) => {
    gatewayText += chunk;
    appendFileSync(gatewayLog, chunk);
  });
}
const marker = async (label) => {
  // A server-side record delimiting each phase in the Gateway's own ws log.
  note({ marker: label });
  await cli(["gateway", "call", "health", "--json"]);
};

async function waitFor(pred, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label}`);
}

let browser;
try {
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/`)).status === 200;
    } catch {
      return false;
    }
  }, 180_000, "gateway http");
  await waitFor(() => /ready/i.test(gatewayText), 60_000, "gateway ready line");
  const version = await cli(["--version"]);
  note({ step: "gateway up", version: version.stdout.trim(), pid: gateway.pid });

  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    colorScheme: "light",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  // Keep the sign-in popup offline: only the loopback Gateway is reachable.
  await context.route(/.*/u, (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    note({ blockedExternal: url.origin });
    return route.abort();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // Passive observation of the UI's own Gateway socket (no frame is altered or injected).
  const pending = new Map();
  const wizardFrames = [];
  const interesting = /^(openclaw\.setup\.|wizard\.)/u;
  page.on("websocket", (ws) => {
    ws.on("framesent", ({ payload }) => {
      let f;
      try {
        f = JSON.parse(String(payload));
      } catch {
        return;
      }
      if (f.type === "req" && interesting.test(String(f.method))) {
        pending.set(f.id, f.method);
        const p = f.params ?? {};
        const entry = { dir: "ui->gw", id: f.id, method: f.method };
        if (p.sessionId) entry.sessionId = p.sessionId;
        if (p.authChoice) entry.authChoice = p.authChoice;
        if (p.answer) entry.answer = Object.keys(p.answer);
        wizardFrames.push(entry);
        note(entry);
      }
    });
    ws.on("framereceived", ({ payload }) => {
      let f;
      try {
        f = JSON.parse(String(payload));
      } catch {
        return;
      }
      if (f.type === "res" && pending.has(f.id)) {
        const method = pending.get(f.id);
        pending.delete(f.id);
        const p = f.payload ?? {};
        const entry = { dir: "gw->ui", id: f.id, method, ok: f.ok };
        for (const k of ["sessionId", "done", "status", "error"]) if (k in p) entry[k] = p[k];
        if (p.step) entry.step = { type: p.step.type, title: p.step.title };
        if (method === "openclaw.setup.auto") entry.payload = { status: p.status, signIn: p.signIn };
        if (f.error) entry.error = f.error;
        wizardFrames.push(entry);
        note(entry);
      }
    });
  });

  const handoff = await cli(["dashboard", "--json"]);
  const entry = new URL(`http://127.0.0.1:${port}/chat/main/12345678`);
  entry.hash = new URL(String(JSON.parse(handoff.stdout).browserUrl)).hash;
  await page.goto(entry.toString());
  const login = page.getByRole("link", { name: "Log in", exact: true });
  await login.click();
  await page.waitForFunction(() => window.openclawControlUi?.snapshot?.()?.ready === true, null, {
    timeout: 60_000,
  });
  note({ step: "ui connected", url: page.url().replace(/#.*/u, "") });
  const bundle = await page.evaluate(() =>
    [...document.scripts].map((s) => s.src).filter(Boolean).map((s) => new URL(s).pathname),
  );
  note({ step: "served bundle", bundle });

  if (mode === "recon") {
    await page.goto(`http://127.0.0.1:${port}/settings/model-setup?firstRun=1`);
    await page.waitForTimeout(5000);
    writeFileSync(path.join(outDir, `${arm}-recon-modelsetup.aria.txt`), await page.locator("body").ariaSnapshot());
    writeFileSync(
      path.join(outDir, `${arm}-recon-modelsetup.choices.txt`),
      (await page.locator("[data-auth-choice]").evaluateAll((els) => els.map((e) => e.getAttribute("data-auth-choice")))).join("\n"),
    );
    await page.screenshot({ path: path.join(outDir, `${arm}-recon-modelsetup.png`), fullPage: true });
    await page.goto(`http://127.0.0.1:${port}/custodian?onboarding=1`);
    await page.waitForTimeout(20000);
    writeFileSync(path.join(outDir, `${arm}-recon-custodian.aria.txt`), await page.locator("body").ariaSnapshot());
    await page.screenshot({ path: path.join(outDir, `${arm}-recon-custodian.png`), fullPage: true });
  } else {
    const surfaces = (process.env.PROOF_SURFACES ?? "model-setup:openai-device-code,custodian").split(",");
    for (const surface of surfaces) {
      try {
        await proveSurface(surface);
      } catch (error) {
        note({ surface, error: String(error?.stack ?? error) });
        process.exitCode = 1;
      }
    }
  }

  async function cancelExternally(surface) {
    const start = wizardFrames.findLast((f) => f.method === "openclaw.setup.auth.start" && f.dir === "ui->gw");
    const sessionId = start?.sessionId;
    if (!sessionId) throw new Error(`${surface}: no sign-in sessionId observed`);
    // The sign-in must be admitted and the UI's wizard.next must still be waiting.
    await waitFor(
      () => [...pending.values()].includes("wizard.next"),
      60_000,
      `${surface}: pending wizard.next`,
    );
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, `${arm}-${surface}-pending.png`) });
    const status = await cli(["gateway", "call", "wizard.status", "--params", JSON.stringify({ sessionId: "unknown-probe" }), "--json"]);
    note({ step: `${surface}: control probe wizard.status unknown id`, code: status.code, stderr: status.stderr.trim().split("\n").slice(-1)[0] });
    note({ step: `${surface}: second client calls wizard.cancel`, sessionId });
    const cancel = await cli(["gateway", "call", "wizard.cancel", "--params", JSON.stringify({ sessionId }), "--json"]);
    note({ step: `${surface}: wizard.cancel result`, code: cancel.code, stdout: cancel.stdout.trim(), stderr: cancel.stderr.trim().slice(-400) });
    writeFileSync(
      path.join(outDir, `${arm}-${surface}-wizard-cancel.txt`),
      `$ openclaw --profile ${profile} gateway call wizard.cancel --params '{"sessionId":"${sessionId}"}' --json\n${cancel.stdout}`,
    );
    return sessionId;
  }

  async function record(surface, scope, alert) {
    await alert.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    const lines = [
      `ARM ${arm} SURFACE ${surface}`,
      `alert.count ${await scope.getByRole("alert").count()}`,
      `alert.textContent ${JSON.stringify(await alert.textContent())}`,
      `alert.outerHTML ${await alert.evaluate((el) => el.outerHTML)}`,
      "ariaSnapshot:",
      await scope.ariaSnapshot(),
    ];
    writeFileSync(path.join(outDir, `${arm}-${surface}-alert.txt`), lines.join("\n") + "\n");
    await page.screenshot({ path: path.join(outDir, `${arm}-${surface}.png`) });
    note({ step: `${surface}: rendered alert`, text: await alert.textContent() });
  }

  async function proveSurface(spec) {
    const surface = spec.replace(":", "-");
    await marker(`begin ${surface}`);
    if (spec.startsWith("model-setup")) {
      const authChoice = spec.split(":")[1] ?? "openai-device-code";
      await page.goto(`http://127.0.0.1:${port}/settings/model-setup?firstRun=1`);
      const choice = page.locator(`[data-auth-choice="${authChoice}"] button`);
      if (!(await choice.first().isVisible().catch(() => false))) {
        const more = page.getByRole("button", { name: /more sign-in|other sign-in|more options|show all/iu });
        if (await more.first().isVisible().catch(() => false)) await more.first().click();
      }
      const popup = context.waitForEvent("page", { timeout: 5_000 }).catch(() => undefined);
      await choice.first().click();
      const opened = await popup;
      note({ step: "model-setup: sign-in started", popupOpened: Boolean(opened) });
      await page.bringToFront();
      await cancelExternally(surface);
      const dialog = page.locator("openclaw-modal-dialog");
      await record(surface, dialog.locator(".model-setup-wizard"), dialog.getByRole("alert"));
      if (opened && !opened.isClosed()) await opened.close();
    } else {
      await page.goto(`http://127.0.0.1:${port}/custodian?onboarding=1`);
      const card = page.locator(".custodian-setup");
      const signIn = card.getByRole("button", { name: "Sign in with ChatGPT" });
      await signIn.waitFor({ timeout: 240_000 });
      await page.screenshot({ path: path.join(outDir, `${arm}-custodian-needs-sign-in.png`) });
      const popup = context.waitForEvent("page", { timeout: 5_000 }).catch(() => undefined);
      await signIn.click();
      const opened = await popup;
      note({ step: "custodian: sign-in started", popupOpened: Boolean(opened) });
      await page.bringToFront();
      await cancelExternally(surface);
      await record(surface, card, card.getByRole("alert"));
      if (opened && !opened.isClosed()) await opened.close();
    }
    await marker(`end ${surface}`);
  }
  note({ step: "page errors", pageErrors });
  writeFileSync(path.join(outDir, `${arm}-wizard-frames.json`), JSON.stringify(wizardFrames, null, 2));
} catch (error) {
  note({ error: String(error?.stack ?? error) });
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  gateway.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 3000));
  if (gateway.exitCode === null) gateway.kill("SIGKILL");
  note({ step: "gateway stopped", exitCode: gateway.exitCode, signal: gateway.signalCode });
  const fileLogDir = "/tmp/openclaw";
  if (existsSync(fileLogDir)) note({ fileLogDir });
}
