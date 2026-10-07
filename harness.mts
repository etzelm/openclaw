// Evidence harness for openclaw/openclaw#166304. Runs searchMemoryWiki through the
// real entrypoint on a generated vault and samples event-loop delay, a concurrent
// probe's latency, and heap use while the whole-vault read runs.
//
// Usage:
//   node --import tsx harness.mts generate --vault <dir> --pages N --lines L --claims C
//   node --import tsx harness.mts search --vault <dir> --query "<text>" --out <file.json> --label before|after
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import type { Worker } from "node:worker_threads";

const PLUGIN_SRC = process.env.MEMORY_WIKI_SRC ?? path.resolve(process.cwd(), "extensions/memory-wiki/src");

function readArg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`missing --${name}`);
  }
  return process.argv[index + 1]!;
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const WORDS = [
  "harbor", "lantern", "ledger", "cobalt", "meridian", "quarry", "saffron", "tundra", "velvet",
  "willow", "zephyr", "anchor", "beacon", "cinder", "delta", "ember", "fathom", "granite", "hollow",
  "isthmus", "juniper", "kestrel", "lagoon", "marrow", "nimbus", "orchard", "pewter", "quartz",
  "ravine", "sextant", "timber", "umber", "vellum", "wharf", "yarrow", "zenith",
];

function words(random: () => number, count: number): string {
  const out: string[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push(WORDS[Math.floor(random() * WORDS.length)]!);
  }
  return out.join(" ");
}

async function generate() {
  const vault = path.resolve(readArg("vault"));
  const pages = Number(readArg("pages"));
  const lines = Number(readArg("lines"));
  const claims = Number(readArg("claims"));
  const { renderWikiMarkdown } = await import(pathToFileURL(path.join(PLUGIN_SRC, "markdown.ts")).href);
  const random = createSeededRandom(166304);
  const groups = ["sources", "entities", "concepts", "syntheses"] as const;
  for (const group of groups) {
    await fs.mkdir(path.join(vault, group), { recursive: true });
  }
  let bytes = 0;
  for (let index = 0; index < pages; index += 1) {
    const group = groups[index % groups.length]!;
    const title = `${words(random, 3)} ${index}`;
    const body: string[] = [`# ${title}`, ""];
    for (let line = 0; line < lines; line += 1) {
      body.push(`${words(random, 14)}.`);
    }
    const frontmatter: Record<string, unknown> = {
      pageType: group === "sources" ? "source" : group === "entities" ? "entity" : group === "concepts" ? "concept" : "synthesis",
      id: `${group.slice(0, -1)}.page-${index}`,
      title,
      sourceIds: [`source.page-${(index * 13) % pages}`, `source.page-${(index * 17) % pages}`],
      aliases: [words(random, 2), words(random, 1)],
      updatedAt: new Date(Date.UTC(2026, 0, 1 + (index % 300))).toISOString(),
      claims: Array.from({ length: claims }, (_, claimIndex) => ({
        id: `claim.page-${index}.${claimIndex}`,
        text: `${words(random, 9)}.`,
        status: claimIndex % 7 === 0 ? "contested" : "supported",
        confidence: Math.round(random() * 100) / 100,
        evidence: [
          { kind: "source", sourceId: `source.page-${(index + claimIndex) % pages}`, note: words(random, 4) },
        ],
      })),
    };
    const rendered = renderWikiMarkdown({ frontmatter, body: body.join("\n") + "\n" });
    bytes += Buffer.byteLength(rendered);
    await fs.writeFile(path.join(vault, group, `page-${index}.md`), rendered);
  }
  console.log(JSON.stringify({ generated: { vault, pages, lines, claims, bytes } }));
}

function createMemoryKeyedStore<T>(values = new Map<string, unknown>()) {
  return {
    async register(key: string, value: T) { values.set(key, value); },
    async registerIfAbsent(key: string, value: T) { if (values.has(key)) { return false; } values.set(key, value); return true; },
    async lookup(key: string) { return values.get(key) as T | undefined; },
    async consume(key: string) { const value = values.get(key) as T | undefined; values.delete(key); return value; },
    async delete(key: string) { return values.delete(key); },
    async entries() { return [...values.entries()].map(([key, value]) => ({ key, value: value as T, createdAt: 0 })); },
    async clear() { values.clear(); },
  };
}

function createMemoryBlobStore<T>() {
  const values = new Map<string, { key: string; bytes: Uint8Array; metadata: T; sizeBytes: number; createdAt: number; expiresAt?: number }>();
  const register = async (key: string, bytes: Uint8Array, metadata: T, opts?: { ttlMs?: number }) => {
    values.set(key, { key, bytes, metadata, sizeBytes: bytes.byteLength, createdAt: Date.now(), ...(opts?.ttlMs ? { expiresAt: Date.now() + opts.ttlMs } : {}) });
  };
  return {
    register,
    async registerIfAbsent(key: string, bytes: Uint8Array, metadata: T, opts?: { ttlMs?: number }) { if (values.has(key)) { return false; } await register(key, bytes, metadata, opts); return true; },
    async lookup(key: string) { return values.get(key); },
    async entries() { return [...values.values()].map(({ bytes: _bytes, ...entry }) => entry); },
    async delete(key: string) { return values.delete(key); },
    async deleteExpiredKey() { return undefined; },
    async deleteExpired() { return []; },
    async clear() { values.clear(); },
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) { return 0; }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index]!;
}

async function search() {
  const vault = path.resolve(readArg("vault"));
  const query = readArg("query");
  const out = path.resolve(readArg("out"));
  const label = readArg("label");
  const compile = readArg("compile", "no") === "yes";
  const load = (file: string) => import(pathToFileURL(path.join(PLUGIN_SRC, file)).href);
  const compiledCache = await load("compiled-cache.ts");
  const sourceSync = await load("source-sync-state.ts");
  const importRuns = await load("import-runs-state.ts");
  const configModule = await load("config.ts");
  const vaultModule = await load("vault.ts");
  const queryModule = await load("query.ts");
  const compileModule = await load("compile.ts");
  const blobStore = createMemoryBlobStore<unknown>();
  compiledCache.configureMemoryWikiCompiledCacheStore(
    compiledCache.createMemoryWikiCompiledCacheStore(() => blobStore),
  );
  sourceSync.configureMemoryWikiSourceSyncStateStore(
    sourceSync.createMemoryWikiSourceSyncStateStore(() => createMemoryKeyedStore()),
  );
  importRuns.configureMemoryWikiImportRunStateStore(
    importRuns.createMemoryWikiImportRunStateStore(() => createMemoryKeyedStore()),
  );
  const config = configModule.resolveMemoryWikiConfig(
    { search: { backend: "local", corpus: "wiki" }, vault: { path: vault } },
    { homedir: os.homedir() },
  );
  await vaultModule.initializeMemoryWikiVault(config);
  if (compile) {
    const compileStart = performance.now();
    await compileModule.compileMemoryWikiVault(config);
    console.log(JSON.stringify({ compiledMs: Math.round(performance.now() - compileStart) }));
  }
  // Every Worker created in this process is announced on the "worker" event; the
  // reader pool's worker is sampled with Worker.getHeapStatistics() (Node 24). Registered before the warm-up search, which is where the pool creates it.
  const workers: Worker[] = [];
  process.on("worker", (worker: Worker) => {
    workers.push(worker);
  });
  // The wiki_search tool always passes a signal (deadline plus turn cancellation), so
  // both runs receive one; it is never aborted here because the harness measures where
  // the scan runs, not the tool's 30 s deadline.
  const signal = new AbortController().signal;
  // Warm module graphs (and, after the change, the worker) with a query that cannot
  // match anything, so the measured run reflects the page read and scoring only.
  // Note: this warm-up itself performs a whole-vault read when the vault has no digest.
  const warmStart = performance.now();
  await queryModule.searchMemoryWiki({
    config,
    query: "zzzz-no-such-token-166304",
    maxResults: 10,
    signal,
  });
  const warmMs = performance.now() - warmStart;

  // The pool unrefs its worker once idle; a pending Worker.getHeapStatistics() reply
  // alone would not keep the process alive, so hold a ref'd timer for the window.
  const keepAlive = setInterval(() => {}, 2 ** 30);
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  const probeLatencies: number[] = [];
  const probeLateness: number[] = [];
  const heapSamples: number[] = [];
  const rssSamples: number[] = [];
  const rssMinusMainHeapSamples: number[] = [];
  const workerHeapSamples: number[] = [];
  let stop = false;
  const probe = (async () => {
    while (!stop) {
      const scheduledAt = performance.now();
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      const firedAt = performance.now();
      probeLateness.push(firedAt - scheduledAt - 100);
      const started = performance.now();
      await fs.access(vault);
      probeLatencies.push(performance.now() - started);
      const usage = process.memoryUsage();
      heapSamples.push(usage.heapUsed);
      rssSamples.push(usage.rss);
      rssMinusMainHeapSamples.push(usage.rss - usage.heapUsed);
      for (const worker of workers) {
        try {
          const stats = await worker.getHeapStatistics();
          workerHeapSamples.push(stats.used_heap_size);
        } catch {
          // A retired worker rejects; nothing to sample.
        }
      }
    }
  })();
  const utilizationStart = performance.eventLoopUtilization();
  const threadCpuStart = process.threadCpuUsage();
  const processCpuStart = process.cpuUsage();
  histogram.enable();
  const searchStart = performance.now();
  const results = await queryModule.searchMemoryWiki({ config, query, maxResults: 10, signal });
  const searchWallMs = performance.now() - searchStart;
  histogram.disable();
  const utilization = performance.eventLoopUtilization(utilizationStart);
  const threadCpu = process.threadCpuUsage(threadCpuStart);
  const processCpu = process.cpuUsage(processCpuStart);
  stop = true;
  await probe;
  clearInterval(keepAlive);

  const latencies = probeLatencies.toSorted((left, right) => left - right);
  const lateness = probeLateness.toSorted((left, right) => left - right);
  const report = {
    label,
    machine: `${os.platform()} ${os.arch()} node ${process.version}`,
    capturedAt: new Date().toISOString(),
    vault: { path: vault, compiled: compile },
    query,
    warmupMs: Math.round(warmMs),
    searchWallMs: Math.round(searchWallMs),
    eventLoopUtilization: Number(utilization.utilization.toFixed(3)),
    mainThreadCpuMs: Math.round((threadCpu.user + threadCpu.system) / 1000),
    processCpuMs: Math.round((processCpu.user + processCpu.system) / 1000),
    eventLoopDelayMs: {
      p50: Number((histogram.percentile(50) / 1e6).toFixed(1)),
      p99: Number((histogram.percentile(99) / 1e6).toFixed(1)),
      max: Number((histogram.max / 1e6).toFixed(1)),
      mean: Number((histogram.mean / 1e6).toFixed(1)),
    },
    probe: {
      samples: latencies.length,
      fsAccessLatencyMs: {
        p50: Number(quantile(latencies, 0.5).toFixed(1)),
        p99: Number(quantile(latencies, 0.99).toFixed(1)),
        max: Number(quantile(latencies, 1).toFixed(1)),
      },
      timerLatenessMs: {
        p50: Number(quantile(lateness, 0.5).toFixed(1)),
        p99: Number(quantile(lateness, 0.99).toFixed(1)),
        max: Number(quantile(lateness, 1).toFixed(1)),
      },
    },
    memoryMb: {
      mainThreadHeapUsedPeak: Number((Math.max(0, ...heapSamples) / 1048576).toFixed(1)),
      processRssPeak: Number((Math.max(0, ...rssSamples) / 1048576).toFixed(1)),
      processRssMinusMainHeapPeak: Number(
        (Math.max(0, ...rssMinusMainHeapSamples) / 1048576).toFixed(1),
      ),
      workerThreads: workers.length,
      workerHeapUsedPeak:
        workerHeapSamples.length > 0
          ? Number((Math.max(...workerHeapSamples) / 1048576).toFixed(1))
          : null,
      workerHeapSamples: workerHeapSamples.length,
    },
    // Every result object whole, so the BEFORE/AFTER comparison covers every field.
    results,
  };
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  try {
    const reader = await load("query-reader.ts");
    await reader.closeMemoryWikiQueryReader();
  } catch {
    // The base tree has no reader module; nothing to close.
  }
  process.exit(0);
}

// Cold first read: the first single-page wiki_get after process start pays the worker
// spawn and its module load; the second read on the same process is the warm figure.
async function cold() {
  const vault = path.resolve(readArg("vault"));
  const out = path.resolve(readArg("out"));
  const load = (file: string) => import(pathToFileURL(path.join(PLUGIN_SRC, file)).href);
  const compiledCache = await load("compiled-cache.ts");
  const sourceSync = await load("source-sync-state.ts");
  const importRuns = await load("import-runs-state.ts");
  const configModule = await load("config.ts");
  const vaultModule = await load("vault.ts");
  const queryModule = await load("query.ts");
  compiledCache.configureMemoryWikiCompiledCacheStore(
    compiledCache.createMemoryWikiCompiledCacheStore(() => createMemoryBlobStore<unknown>()),
  );
  sourceSync.configureMemoryWikiSourceSyncStateStore(
    sourceSync.createMemoryWikiSourceSyncStateStore(() => createMemoryKeyedStore()),
  );
  importRuns.configureMemoryWikiImportRunStateStore(
    importRuns.createMemoryWikiImportRunStateStore(() => createMemoryKeyedStore()),
  );
  const config = configModule.resolveMemoryWikiConfig(
    { search: { backend: "local", corpus: "wiki" }, vault: { path: vault } },
    { homedir: os.homedir() },
  );
  await vaultModule.initializeMemoryWikiVault(config);
  const keepAlive = setInterval(() => {}, 2 ** 30);
  const timings: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const started = performance.now();
    const page = await queryModule.getMemoryWikiPage({ config, lookup: "entities/page-1.md" });
    timings.push(Math.round(performance.now() - started));
    if (!page) {
      throw new Error("entities/page-1.md not found");
    }
  }
  clearInterval(keepAlive);
  const report = {
    label: "cold-first-read",
    machine: `${os.platform()} ${os.arch()} node ${process.version}`,
    capturedAt: new Date().toISOString(),
    vault,
    lookup: "entities/page-1.md",
    readMs: { first: timings[0], second: timings[1], third: timings[2] },
    note: "first read spawns the reader worker from TypeScript source through tsx; dist loading was not measured",
  };
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  try {
    const reader = await load("query-reader.ts");
    await reader.closeMemoryWikiQueryReader();
  } catch {
    // The base tree has no reader module; nothing to close.
  }
  process.exit(0);
}

const command = process.argv[2];
if (command === "generate") {
  await generate();
} else if (command === "search") {
  await search();
} else if (command === "cold") {
  await cold();
} else {
  throw new Error(`unknown command: ${command}`);
}
