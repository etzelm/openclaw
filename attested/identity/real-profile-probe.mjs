// One real GET /api/oauth/profile with the logged-in Claude CLI access token, plus one with a
// synthetic token. Prints only status, latency, response key shape, 12-hex SHA-256 prefixes and
// booleans. The token, the uuid and the email are never printed or written anywhere.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const h = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 12);
const shape = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, typeof v[k] === "object" && v[k] !== null && !Array.isArray(v[k]) ? shape(v[k]) : typeof v[k]]))
    : typeof v;
const home = os.homedir();
const cred = JSON.parse(fs.readFileSync(path.join(home, ".claude", ".credentials.json"), "utf8")).claudeAiOauth;
const record = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8")).oauthAccount ?? {};
const call = async (token) => {
  const t0 = performance.now();
  const res = await fetch("https://api.anthropic.com/api/oauth/profile", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "openclaw" },
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  const ms = Math.round(performance.now() - t0);
  let body; try { body = await res.json(); } catch { body = undefined; }
  return { status: res.status, ms, body };
};
const expiresInMin = Math.round((cred.expiresAt - Date.now()) / 60000);
const real = await call(cred.accessToken);
const out = {
  tokenExpiresInMin: expiresInMin,
  real: { status: real.status, latencyMs: real.ms, shape: shape(real.body) },
};
if (real.status === 200) {
  out.real.accountUuidHash = h(real.body.account?.uuid);
  out.real.accountUuidEqualsRecord = real.body.account?.uuid === record.accountUuid;
  out.real.emailEqualsRecord = real.body.account?.email === record.emailAddress;
  out.real.orgUuidEqualsRecord = real.body.organization?.uuid === record.organizationUuid;
  out.recordAccountUuidHash = h(record.accountUuid);
}
const after = JSON.parse(fs.readFileSync(path.join(home, ".claude", ".credentials.json"), "utf8")).claudeAiOauth;
out.credentialUnchanged = after.accessToken === cred.accessToken && after.refreshToken === cred.refreshToken;
const fake = await call("sk-ant-oat01-synthetic-not-a-token");
out.synthetic = { status: fake.status, latencyMs: fake.ms, shape: shape(fake.body) };
console.log(JSON.stringify(out, null, 2));
