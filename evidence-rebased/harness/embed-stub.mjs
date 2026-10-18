#!/usr/bin/env node
// Loopback OpenAI-compatible /v1/embeddings stub for the t2-03 proof.
// usage: node embed-stub.mjs <port-file> <request-log.jsonl> [port]   (port 0 or omitted: ephemeral)
// Deterministic per input text: sha256(text) seeds a xoshiro128** PRNG; 4096 double-precision
// coordinates drawn uniformly in [-0.5, 0.5) then L2-normalized (full 53-bit mantissa values).
// Per request it logs seq, input count and total characters. No input text, no hashes.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

const DIMS = 4096;
const MODEL = "stub-embed-4096";
const [, , portFile, logFile, portArg] = process.argv;
let seq = 0;
function rng(seedBytes) {
  const s = new Uint32Array(4);
  for (let i = 0; i < 4; i++) s[i] = seedBytes.readUInt32LE(i * 4) | 1;
  const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  const next32 = () => {
    const r = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 11);
    return r >>> 0;
  };
  // 53-bit double in [0,1)
  return () => ((next32() >>> 5) * 67108864 + (next32() >>> 6)) / 9007199254740992;
}
function vector(text) {
  const rand = rng(crypto.createHash("sha256").update(text).digest());
  const out = new Array(DIMS);
  let sum = 0;
  for (let i = 0; i < DIMS; i++) { out[i] = rand() - 0.5; sum += out[i] * out[i]; }
  const norm = Math.sqrt(sum);
  for (let i = 0; i < DIMS; i++) out[i] /= norm;
  return out;
}
const server = http.createServer((req, res) => {
  const bufs = [];
  req.on("data", (c) => bufs.push(c));
  req.on("end", () => {
    const body = Buffer.concat(bufs).toString("utf8");
    seq += 1;
    let parsed = {};
    try { parsed = body ? JSON.parse(body) : {}; } catch {}
    const inputs = Array.isArray(parsed.input) ? parsed.input : parsed.input == null ? [] : [parsed.input];
    fs.appendFileSync(logFile, `${JSON.stringify({
      seq, at: new Date().toISOString(), method: req.method, path: req.url,
      inputs: inputs.length, chars: inputs.reduce((n, s) => n + String(s).length, 0),
    })}\n`);
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url.endsWith("/embeddings")) {
      res.end(JSON.stringify({
        object: "list", model: MODEL,
        data: inputs.map((s, index) => ({ object: "embedding", index, embedding: vector(String(s)) })),
        usage: { prompt_tokens: 0, total_tokens: 0 },
      }));
    } else if (req.url.endsWith("/models")) {
      res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }
  });
});
server.listen(Number(portArg ?? 0), "127.0.0.1", () => fs.writeFileSync(portFile, String(server.address().port)));
