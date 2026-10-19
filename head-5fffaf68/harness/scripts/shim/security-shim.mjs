// Preloaded into the openclaw process (NODE_OPTIONS=--import). Replaces child_process.execSync
// for `/usr/bin/security find-generic-password` calls, so a run can see the Keychain item as
// readable, confirmed absent (exit 44), or failing with a timeout, and the mode can change while
// a run is in flight by rewriting FAKE_SECURITY_MODE_FILE. Every other command is untouched.
import cp from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const real = cp.execSync;
const modeFile = process.env.FAKE_SECURITY_MODE_FILE;
const logFile = process.env.FAKE_SECURITY_LOG;
cp.execSync = function (command, ...rest) {
  if (typeof command === "string" && command.startsWith("/usr/bin/security find-generic-password")) {
    const mode = modeFile && fs.existsSync(modeFile) ? fs.readFileSync(modeFile, "utf8").trim() : "real";
    const kind = command.includes(" -w ") ? "password" : "metadata";
    if (logFile) {
      fs.appendFileSync(
        logFile,
        JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event: "security-lookup", kind, mode, ...(process.env.FAKE_SECURITY_STACKS ? { stack: (new Error().stack ?? "").split("\n").slice(2, 14).map((l) => l.trim().replace(/\(.*\/dist\//, "(dist/").replace(/^at /, "")) } : {}) }) + "\n",
      );
    }
    if (mode === "fail") {
      throw Object.assign(new Error("spawnSync /usr/bin/security ETIMEDOUT"), {
        code: "ETIMEDOUT",
        status: null,
        signal: "SIGTERM",
      });
    }
    if (mode === "absent") {
      throw Object.assign(new Error("The specified item could not be found in the keychain."), { status: 44 });
    }
    if (mode === "present") {
      return kind === "password"
        ? JSON.stringify({ claudeAiOauth: { accessToken: "synthetic-keychain", expiresAt: 1893456000000 } })
        : "";
    }
  }
  return real.call(this, command, ...rest);
};
syncBuiltinESMExports();
