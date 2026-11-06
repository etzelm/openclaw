// Idle-render probe for the spinner-art change (evidence tooling, not part of the patch).
// Usage: node --import ./scripts/tsx.mjs <this> <engine> <scenario> [idleMs] [settleMs]
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, webkit, type Browser } from "playwright";
import { startControlUiBenchGatewayServer } from "./lib/control-ui-bench-gateway-server.ts";
import { normalizeControlUiBuildInfo } from "../ui/src/build-info-normalizers.ts";
import {
  controlUiBundledGatewayUrl,
  controlUiBundledSettingsStorageKey,
  installMockGateway,
  resolvePlaywrightChromiumExecutablePath,
  startProductionControlUiE2eServer,
} from "../ui/src/test-helpers/control-ui-e2e.ts";

const [engine = "webkit", scenarioName = "history", idleArg = "15000", settleArg = "8000"] =
  process.argv.slice(2);
const idleMs = Number(idleArg);
const settleMs = Number(settleArg);
const buildId = "idle-probe-build";
const outDir = process.env.PROBE_OUT ?? path.join(os.tmpdir(), "oc-idle-probe-dist");
const disableCss = process.env.PROBE_DISABLE_CSS ?? "";

let builtServer: { close(): Promise<void> } | undefined;
if (!process.env.PROBE_REUSE) {
  builtServer = await startProductionControlUiE2eServer(outDir, buildId);
  await builtServer.close();
}
const html = await readFile(path.join(outDir, "index.html"), "utf8");
const identity = normalizeControlUiBuildInfo(JSON.parse(html.match(/globalThis\.OPENCLAW_CONTROL_UI_BUILD_INFO=(\{.*?\});<\/script>/su)![1]!));
const server = await startControlUiBenchGatewayServer(outDir);
const version = identity.version!;
const browser: Browser =
  engine === "webkit"
    ? await webkit.launch({ headless: true })
    : await chromium.launch({
        headless: true,
        executablePath: resolvePlaywrightChromiumExecutablePath(chromium.executablePath()),
      });

function treeCpuByProcess(): Record<string, number> {
  const localBrowser = browser as Browser & {
    _connection: { toImpl(b: Browser): { options: { browserProcess: { process: { pid: number } } } } };
  };
  // eslint-disable-next-line no-underscore-dangle
  const pid = localBrowser._connection.toImpl(browser).options.browserProcess.process.pid;
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,time=,comm="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => {
      const [id, parent, time, ...comm] = line.trim().split(/\s+/u);
      const parts = time!.split(":").map(Number);
      const seconds = parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + parts[1]!;
      return { id: Number(id), parent: Number(parent), seconds, comm: comm.join(" ") };
    });
  const owned = new Set([pid]);
  let size = 0;
  while (size !== owned.size) {
    size = owned.size;
    for (const row of rows) if (owned.has(row.parent)) owned.add(row.id);
  }
  const out: Record<string, number> = {};
  for (const r of rows.filter((r) => owned.has(r.id) || r.comm.includes(process.env.PLAYWRIGHT_BROWSERS_PATH ?? "ms-playwright"))) {
    const name = `${r.comm.split("/").pop()}#${r.id}`;
    out[name] = r.seconds;
  }
  return out;
}
function treeCpuSeconds(): number { return Object.values(treeCpuByProcess()).reduce((a, b) => a + b, 0); }

import { createControlUiSessionRow as sessionRow } from "../ui/src/test-helpers/control-ui-session-fixtures.ts";
const sessionsListResponse = (sessions: unknown[]) => ({ count: sessions.length, defaults: { contextTokens: null, model: "gpt-5.5", modelProvider: "openai" }, hasMore: false, limitApplied: 50, nextOffset: null, offset: 0, path: "", sessions, totalCount: sessions.length, ts: Date.now() });
const now = Date.now();
const historyScenario = {
  subscriptionInitialHistory: true,
  historyMessages: [
    { role: "user", content: [{ type: "text", text: "Hello there" }] },
    { role: "assistant", content: [{ type: "text", text: "Ready. Here is a reply with **markdown**." }] },
  ],
};
const runningRows = [
  sessionRow("agent:main:main", "Main", now),
  sessionRow("agent:main:worker-a", "Worker A running", now - 1, { hasActiveRun: true, status: "running" }),
  sessionRow("agent:main:worker-b", "Worker B running", now - 2, { hasActiveRun: true, status: "running" }),
  sessionRow("agent:main:worker-q", "Worker queued", now - 3, { hasActiveRun: true, status: "queued" }),
  ...Array.from({ length: 12 }, (_, i) => sessionRow(`agent:main:idle-${i}`, `Idle session ${i}`, now - 10 - i)),
];
const scenarios: Record<string, Record<string, unknown>> = {
  running: { ...historyScenario, sessionKey: "agent:main:main", methodResponses: { "sessions.list": sessionsListResponse(runningRows) } },
  empty: {},
  history: {
    subscriptionInitialHistory: true,
    historyMessages: [
      { role: "user", content: [{ type: "text", text: "Hello there" }] },
      { role: "assistant", content: [{ type: "text", text: "Ready. Here is a reply with **markdown**." }] },
      { role: "user", content: [{ type: "text", text: "Thanks" }] },
      { role: "assistant", content: [{ type: "text", text: "Anytime." }] },
    ],
  },
};

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", deviceScaleFactor: process.env.PROBE_PARITY ? 4 : 1 });
const page = await context.newPage();
await page.addInitScript({ content: "window.__name = (fn) => fn;" });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error("CONSOLE", m.type(), m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.error("PAGEERROR", String(e).slice(0, 400)));
page.on("requestfailed", (r) => console.error("REQFAIL", r.url().slice(0, 150), r.failure()?.errorText));
await page.addInitScript(() => {
  const w = window as unknown as Record<string, unknown>;
  const counts = new Map<string, number>();
  const original = window.requestAnimationFrame.bind(window);
  w.__rafProbe = { counts, enabled: false, total: 0 };
  window.requestAnimationFrame = (callback) => {
    const probe = w.__rafProbe as { enabled: boolean; total: number };
    if (probe.enabled) {
      probe.total += 1;
      const stack = (new Error().stack ?? "").split("\n").slice(1, 5).map((s) => s.trim()).join(" | ");
      counts.set(stack, (counts.get(stack) ?? 0) + 1);
    }
    return original(callback);
  };
});
if (disableCss) {
  await page.addInitScript((css) => {
    const apply = () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.documentElement.append(style);
    };
    if (document.documentElement) apply();
    else document.addEventListener("DOMContentLoaded", apply);
  }, disableCss);
}
await page.addInitScript(({ key, gatewayUrl }) => {
  if (window === window.top) localStorage.setItem(key, JSON.stringify({ gatewayUrl, lobsterPetVisits: false }));
}, { key: controlUiBundledSettingsStorageKey(server.baseUrl), gatewayUrl: controlUiBundledGatewayUrl(server.baseUrl) });
await installMockGateway(page, {
  ...scenarios[scenarioName],
  serverBuildId: identity.buildId,
  serverVersion: version,
  awaitInitialRoster: false,
} as never);
console.error("STEP await page.goto(", Date.now());
await page.goto(new URL(process.env.PROBE_PATH ?? "chat", server.baseUrl).href, { waitUntil: "domcontentloaded" });
console.error("STEP await page.waitForSelector(", Date.now());
try {
  await page.waitForSelector(process.env.PROBE_WAIT ?? "openclaw-chat-page", { timeout: 30_000, state: "attached" });
} catch (error) {
  console.error("URL", page.url());
  console.error("BODY", (await page.evaluate(() => document.body?.innerText ?? "")).slice(0, 600));
  await page.screenshot({ path: path.join(process.env.PROBE_SHOTS ?? ".", `fail-${engine}.png`) });
  throw error;
}
console.error("STEP await page.waitForTimeout(sett", Date.now());
await page.waitForTimeout(settleMs);
if (process.env.PROBE_SNAPSHOT) {
  const snap = await page.evaluate(() => {
    let shadows = 0;
    const VOID = new Set(["area","base","br","col","embed","hr","img","input","link","meta","source","track","wbr"]);
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const attr = (t: string) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const sheetText = (sheet: CSSStyleSheet) => { try { return [...sheet.cssRules].map((r) => r.cssText).join("\n"); } catch { return ""; } };
    const ser = (node: Node): string => {
      if (node.nodeType === 3) return esc(node.nodeValue ?? "");
      if (node.nodeType !== 1) return "";
      const el = node as Element;
      const tag = el.localName;
      if (tag === "script" || tag === "template") return "";
      if (tag === "link" && /preload|manifest|icon/.test(el.getAttribute("rel") ?? "")) return "";
      let out = `<${tag}` + [...el.attributes].map((a) => ` ${a.name}="${attr(a.value)}"`).join("") + ">";
      if (VOID.has(tag)) return out;
      if (tag === "style") return out + ((el as HTMLStyleElement).sheet ? sheetText((el as HTMLStyleElement).sheet as CSSStyleSheet) : el.textContent) + "</style>";
      const sr = el.shadowRoot;
      if (sr) {
        shadows++;
        out += `<template shadowrootmode="${sr.mode}">` + sr.adoptedStyleSheets.map((x) => `<style>${sheetText(x)}</style>`).join("") + [...sr.childNodes].map(ser).join("") + "</template>";
      }
      return out + [...el.childNodes].map(ser).join("") + `</${tag}>`;
    };
    let html = ser(document.documentElement);
    const docSheets = document.adoptedStyleSheets.map((x) => `<style>${sheetText(x)}</style>`).join("");
    html = html.replace("</head>", docSheets + "</head>");
    return { shadows, html: "<!doctype html>\n" + html, sheets: [...document.styleSheets].map((s) => s.href ?? `inline:${s.ownerNode?.nodeName}`), htmlAttrs: [`docAdopted=${document.adoptedStyleSheets.length}`] };
  });
  const { writeFile: wf } = await import("node:fs/promises");
  await wf(process.env.PROBE_SNAPSHOT, snap.html);
  console.error("SNAPSHOT", JSON.stringify({ shadows: snap.shadows, sheets: snap.sheets, htmlAttrs: snap.htmlAttrs, bytes: snap.html.length }));
}
if (process.env.PROBE_EVAL) {
  const r = await page.evaluate(process.env.PROBE_EVAL);
  console.error("EVAL", JSON.stringify(r));
  await page.waitForTimeout(1500);
}
if (process.env.PROBE_INJECT_HTML) {
  // Place extra spinners into the live page (same stylesheets, same ancestors) for per-type checks.
  const injected = await page.evaluate(({ html, target }) => {
    const host = document.querySelector(target);
    if (!host) return 0;
    const box = document.createElement("div");
    box.setAttribute("data-probe-inject", "");
    box.style.cssText = "display:flex;gap:12px;align-items:center;padding:8px";
    box.innerHTML = html;
    host.prepend(box);
    return box.querySelectorAll("*").length;
  }, { html: process.env.PROBE_INJECT_HTML, target: process.env.PROBE_INJECT_TARGET ?? "openclaw-chat-page" });
  console.error("INJECTED", injected);
  await page.waitForTimeout(1500);
}

let cdp: Awaited<ReturnType<typeof context.newCDPSession>> | undefined;
let before: Record<string, number> = {};
const metricNames = ["TaskDuration", "RecalcStyleCount", "LayoutCount", "ScriptDuration", "RecalcStyleDuration", "LayoutDuration"];
async function metrics() {
  const result = await cdp!.send("Performance.getMetrics");
  return Object.fromEntries(result.metrics.filter((m) => metricNames.includes(m.name)).map((m) => [m.name, m.value]));
}
if (engine === "chromium") {
  cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  before = await metrics();
}
await page.evaluate(() => {
  const probe = (window as unknown as { __rafProbe: { enabled: boolean } }).__rafProbe;
  probe.enabled = true;
});
console.error("STEP const cpuBefore", Date.now());
const perBefore = treeCpuByProcess();
const cpuBefore = treeCpuSeconds();
const wallStart = Date.now();
await page.waitForTimeout(idleMs);
const cpuAfter = treeCpuSeconds();
const perAfter = treeCpuByProcess();
const wall = (Date.now() - wallStart) / 1000;
console.error("STEP const result = await page.eval", Date.now());
const result = await page.evaluate(() => {
  const probe = (window as unknown as { __rafProbe: { counts: Map<string, number>; total: number } }).__rafProbe;
  const describe = (el: Element | null) => {
    if (!el) return "?";
    const parts: string[] = [];
    let node: Element | null = el;
    for (let i = 0; node && i < 3; i++, node = node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null) {
      parts.unshift(`${node.localName}${node.id ? `#${node.id}` : ""}${node.classList.length ? `.${[...node.classList].slice(0, 3).join(".")}` : ""}`);
    }
    return parts.join(" > ");
  };
  const animations = document.getAnimations({ subtree: true } as never).filter((a) => a.playState === "running").map((a) => {
    const effect = a.effect as KeyframeEffect | null;
    const target = effect?.target ?? null;
    const pseudo = effect?.pseudoElement ?? "";
    const name = (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.id;
    const timing = effect?.getComputedTiming();
    return { name, kind: a.constructor.name, iterations: timing?.iterations, target: describe(target as Element) + pseudo };
  });
  return {
    rafTotal: probe.total,
    rafTop: [...probe.counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    animations,
    hidden: document.hidden,
    mascots: document.querySelectorAll("openclaw-mascot").length,
  };
});
const ancestors = process.env.PROBE_ANCESTORS
  ? await page.evaluate(() => {
      const ring = document.querySelector(".session-glyph__ring");
      const out: string[] = [];
      for (let node = ring as Element | null; node && node !== document.documentElement; node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host ?? null)) {
        const c = getComputedStyle(node);
        const facts = {
          overflow: c.overflow, contain: c.contain, cv: c.contentVisibility, mask: c.maskImage.slice(0, 24),
          clip: c.clipPath, radius: c.borderRadius, transform: c.transform.slice(0, 20), will: c.willChange,
          filter: c.filter, backdrop: (c as unknown as Record<string, string>).backdropFilter, opacity: c.opacity,
          position: c.position, isolation: c.isolation, z: c.zIndex,
        };
        const interesting = Object.entries(facts).filter(([k, v]) => !["visible", "none", "auto", "0px", "1", "static", "normal", ""].includes(String(v)) && !(k === "z" && v === "auto"));
        out.push(`${node.localName}.${[...node.classList].slice(0, 2).join(".")} ${JSON.stringify(Object.fromEntries(interesting))}`);
      }
      return out;
    })
  : undefined;
const after = cdp ? await metrics() : {};
const parity: Record<string, string> = {};
if (process.env.PROBE_PARITY) {
  const { createHash: hash } = await import("node:crypto");
  const { writeFile } = await import("node:fs/promises");
  const box = await page.evaluate(() => {
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = 0; }
    const ring = document.querySelector(".sidebar-session-indicator .session-glyph__ring")!;
    const r = ring.getBoundingClientRect();
    return { x: r.x - 4, y: r.y - 4, width: r.width + 8, height: r.height + 8 };
  });
  for (const t of [0, 200, 400, 800, 1200]) {
    await page.evaluate((time) => {
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = time; }
    }, t);
    await page.waitForTimeout(100);
    const png = await page.screenshot({ clip: box, animations: "allow", timeout: 10_000 });
    parity[t] = hash("sha1").update(png).digest("hex").slice(0, 10);
    await writeFile(path.join(process.env.PROBE_SHOTS ?? ".", `ring-${engine}-${process.env.PROBE_PARITY}-${t}.png`), png);
  }
}
const { createHash } = await import("node:crypto");
const ringHashes: string[] = [];
const ring = page.locator(".session-glyph__ring").first();
if (await ring.count()) {
  for (let i = 0; i < 5; i++) {
    const shot = await ring.screenshot({ animations: "allow", timeout: 5_000 }).catch(() => undefined);
    if (!shot) break;
    ringHashes.push(createHash("sha1").update(shot).digest("hex").slice(0, 8));
    await page.waitForTimeout(170);
  }
}
const delta = Object.fromEntries(Object.keys(after).map((k) => [k, +(after[k]! - before[k]!).toFixed(3)]));
console.log(JSON.stringify({ engine, scenarioName, disableCss: Boolean(disableCss), wall, cpuPctOfCore: +(((cpuAfter - cpuBefore) / wall) * 100).toFixed(1), rafPerSec: +(result.rafTotal / wall).toFixed(1), perProcessPct: Object.fromEntries(Object.keys(perAfter).map((k) => [k, +((((perAfter[k] ?? 0) - (perBefore[k] ?? 0)) / wall) * 100).toFixed(1)]).filter(([, v]) => (v as number) > 0.2)), ...result, cdp: delta, parity, ringHashes, ringDistinct: new Set(ringHashes).size, ancestors, load: os.loadavg().map((v) => +v.toFixed(1)) }, null, 1));
console.error("STEP await page.screenshot(", Date.now());
if (process.env.PROBE_STILL) {
  // Same frame for before/after screenshots: pause every animation at t = 0.
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
  });
  await page.waitForTimeout(200);
}
await page.screenshot({ path: path.join(process.env.PROBE_SHOTS ?? ".", `shot-${engine}-${scenarioName}${disableCss ? "-off" : ""}${process.env.PROBE_STILL ? `-${process.env.PROBE_STILL}` : ""}.png`) });
await browser.close();
await server.close();
