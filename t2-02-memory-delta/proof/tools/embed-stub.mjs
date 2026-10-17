#!/usr/bin/env node
// Local OpenAI-compatible /v1/embeddings stub for the t2-02 proof. Loopback only.
// usage: node embed-stub.mjs <port-file> <request-log.jsonl>
// Returns a deterministic 64-dimension vector per input (derived from sha256 of the text),
// and appends one JSON line per HTTP request: sequence, method, path, input count,
// total input characters, and the first 12 hex digits of each input's sha256.
// Request text itself is not logged.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

const [, , portFile, logFile] = process.argv;
let seq = 0;
function vector(text) {
  const out = [];
  let block = crypto.createHash("sha256").update(text).digest();
  while (out.length < 64) {
    for (const byte of block) if (out.length < 64) out.push(byte / 255 - 0.5);
    block = crypto.createHash("sha256").update(block).digest();
  }
  const norm = Math.hypot(...out);
  return out.map((v) => v / norm);
}
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seq += 1;
    let parsed = {};
    try { parsed = body ? JSON.parse(body) : {}; } catch {}
    const inputs = Array.isArray(parsed.input) ? parsed.input : parsed.input == null ? [] : [parsed.input];
    fs.appendFileSync(logFile, `${JSON.stringify({
      seq, at: new Date().toISOString(), method: req.method, path: req.url, model: parsed.model ?? null,
      inputs: inputs.length, chars: inputs.reduce((n, s) => n + String(s).length, 0),
      inputSha: inputs.map((s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 12)),
    })}\n`);
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url.endsWith("/embeddings")) {
      res.end(JSON.stringify({
        object: "list", model: parsed.model ?? "stub-embed-64",
        data: inputs.map((s, index) => ({ object: "embedding", index, embedding: vector(String(s)) })),
        usage: { prompt_tokens: 0, total_tokens: 0 },
      }));
    } else if (req.url.endsWith("/models")) {
      res.end(JSON.stringify({ object: "list", data: [{ id: "stub-embed-64", object: "model" }] }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }
  });
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(portFile, String(server.address().port)));
