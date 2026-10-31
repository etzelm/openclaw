// Proof-only timing instrumentation for #185433 leg 6r. Usage: node instrument.mjs <proxy|ui> <file>...
// proxy: the sandbox proxy answers an activation query 2500 ms late (same answer, read at answer time).
// ui: the dashboard waits up to 10000 ms for that answer instead of 250 ms.
// Every file must match exactly once; nothing else changes.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { brotliCompressSync, gzipSync } from "node:zlib";

const [mode, ...files] = process.argv.slice(2);
const rules = {
  proxy: [
    /window\.parent\.postMessage\(\{\s*jsonrpc: "2\.0",\s*method: "ui\/notifications\/sandbox-activation",\s*params: \{ id: event\.data\.params\?\.id, active: navigator\.userActivation\?\.isActive === true \},\s*\}, hostOrigin\);/g,
    () =>
      'const fw6Id = event.data.params?.id; setTimeout(() => window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-activation", params: { id: fw6Id, active: navigator.userActivation?.isActive === true } }, hostOrigin), 2500);',
  ],
  ui: [
    /setTimeout\(\(\)=>(\w+)\(!1\),(\w+)\),\1=(\w+)=>\{clearTimeout\(/g,
    (match, settle, _limit, arg) => `setTimeout(()=>${settle}(!1),1e4),${settle}=${arg}=>{clearTimeout(`,
  ],
};
const rule = rules[mode];
if (!rule || files.length === 0) {
  console.error("usage: instrument.mjs <proxy|ui> <file>...");
  process.exit(2);
}
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const count = (text.match(rule[0]) ?? []).length;
  if (count !== 1) {
    console.error(`${mode}: ${file} matched ${count} times`);
    process.exit(1);
  }
  const next = text.replace(rule[0], rule[1]);
  writeFileSync(file, next);
  // The Gateway can serve precompressed siblings; keep them in step.
  if (existsSync(`${file}.gz`)) writeFileSync(`${file}.gz`, gzipSync(next));
  if (existsSync(`${file}.br`)) writeFileSync(`${file}.br`, brotliCompressSync(next));
  console.log(`${mode}: instrumented ${file}`);
}
