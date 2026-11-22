// Loopback OpenAI-compatible stub model for qa/rfc0039-foreground/run-proof.sh.
// No credentials. Logs one JSON line per request to $STUB_LOG, including every marker seen
// anywhere in the request (to detect refused input reaching a prompt).
// The newest prompt's marker decides the answer: "SLOW:<marker>" streams one token and holds
// the stream open on its first occurrence (so a restart lands mid-turn); "DELAY:<marker>"
// answers after 6 seconds; later requests answer immediately.
import fs from "node:fs";
import http from "node:http";

const port = Number(process.env.STUB_PORT ?? 19180);
const logPath = process.env.STUB_LOG;
const seen = new Map();

function contentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join(" ");
  }
  return undefined;
}

// The current turn is every user message after the last assistant message. OpenClaw
// may add an internal context message, so the prompt is not always the last one.
function lastUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const texts = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === "assistant") {
      break;
    }
    const text = m?.role === "user" ? contentText(m.content) : undefined;
    if (text !== undefined) {
      texts.unshift(text);
    }
  }
  return texts.join("\n");
}

function log(entry) {
  if (logPath) {
    fs.appendFileSync(logPath, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`);
  }
}

function chunk(id, model, delta, finish = null) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

function parseBody(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url?.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: "slow", object: "model" }] }));
    return;
  }
  const parts = [];
  req.on("data", (d) => {
    parts.push(String(d));
  });
  req.on("end", () => {
    const body = parseBody(parts.join(""));
    const text = lastUserText(body);
    // The newest prompt is last; earlier stopped prompts stay in history.
    const last = [...text.matchAll(/(SLOW|DELAY):([A-Za-z0-9_-]+)/gu)].at(-1);
    const slow = last?.[1] === "SLOW" ? last[2] : undefined;
    const delayed = last?.[1] === "DELAY" ? last[2] : undefined;
    const marker = slow ?? delayed;
    const occurrence = marker ? (seen.get(marker) ?? 0) + 1 : 0;
    if (marker) {
      seen.set(marker, occurrence);
    }
    const hold = Boolean(slow) && occurrence === 1;
    const delayMs = delayed ? 6000 : 0;
    // Every marker anywhere in the full request, to detect rejected input leaking into a prompt.
    const allMarkers = [
      ...JSON.stringify(body.messages ?? []).matchAll(/(?:SLOW|DELAY):([A-Za-z0-9_-]+)/gu),
    ].map((m) => m[1]);
    log({
      url: req.url,
      stream: body.stream === true,
      marker: marker ?? null,
      occurrence,
      hold,
      seen: [...new Set(allMarkers)],
      text: text.slice(-160),
    });
    const id = `stub-${Date.now()}`;
    const model = body.model ?? "slow";
    const reply = marker ? `stub reply for ${marker} (${occurrence})` : "stub reply";
    req.on("close", () => {
      if (!res.writableEnded) {
        log({ event: "client-closed", marker: marker ?? null, occurrence });
      }
    });
    if (body.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(chunk(id, model, { role: "assistant", content: "" }));
      if (hold) {
        res.write(chunk(id, model, { content: "working" }));
        return; // held open until the Gateway aborts or exits
      }
      setTimeout(() => {
        if (res.writableEnded) {
          return;
        }
        res.write(chunk(id, model, { content: reply }));
        res.write(chunk(id, model, {}, "stop"));
        res.write("data: [DONE]\n\n");
        res.end();
        log({ event: "completed", marker: marker ?? null, occurrence });
      }, delayMs);
      return;
    }
    if (hold) {
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          { index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
});
server.listen(port, "127.0.0.1", () => log({ event: "listening", port }));
