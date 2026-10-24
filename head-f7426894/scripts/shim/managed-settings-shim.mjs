// Preloaded into the openclaw process (NODE_OPTIONS=--import). Redirects ONLY paths under
// Claude's macOS admin-managed settings root (/Library/Application Support/ClaudeCode) to the
// per-run fixture dir FAKE_MANAGED_DIR, at the two fs calls the native-login owner uses:
// fs.realpathSync (loadJsonFileThroughSymlink in src/infra/json-file.ts) and fs.readdirSync
// (the managed-settings.d drop-in listing). Nothing is written to the real system dir.
// Every redirected call is logged (one JSON line) to FAKE_MANAGED_LOG with the turn number
// the harness exports as HARNESS_TURN. Production code is unchanged.
import fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";

const ROOT = "/Library/Application Support/ClaudeCode";
const fixture = process.env.FAKE_MANAGED_DIR;
const logFile = process.env.FAKE_MANAGED_LOG;
const cjsFs = createRequire(import.meta.url)("node:fs");

const redirect = (fn, input) => {
  const value = typeof input === "string" ? input : input instanceof URL ? input.pathname : null;
  if (!fixture || value === null || (value !== ROOT && !value.startsWith(`${ROOT}/`))) {
    return undefined;
  }
  const target = fixture + value.slice(ROOT.length);
  if (logFile) {
    fs.appendFileSync(
      logFile,
      JSON.stringify({
        at: new Date().toISOString(),
        pid: process.pid,
        turn: process.env.HARNESS_TURN ?? null,
        fn,
        path: value,
        exists: cjsFs.existsSync(target),
      }) + "\n",
    );
  }
  return target;
};

const realRealpathSync = cjsFs.realpathSync;
const realReaddirSync = cjsFs.readdirSync;
function realpathSync(p, options) {
  const target = redirect("realpathSync", p);
  return target === undefined ? realRealpathSync(p, options) : realRealpathSync(target, options);
}
realpathSync.native = realRealpathSync.native;
function readdirSync(p, options) {
  const target = redirect("readdirSync", p);
  return target === undefined ? realReaddirSync(p, options) : realReaddirSync(target, options);
}
cjsFs.realpathSync = realpathSync;
cjsFs.readdirSync = readdirSync;
syncBuiltinESMExports();
if (fs.realpathSync !== realpathSync || fs.readdirSync !== readdirSync) {
  throw new Error("managed-settings-shim: default node:fs export was not patched");
}
