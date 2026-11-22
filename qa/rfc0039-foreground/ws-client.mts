// Proof client for qa/rfc0039-foreground/run-proof.sh. Connects to the scratch Gateway as a
// trusted-proxy authenticated Control UI client (device-less; scopes come from
// gateway.auth.identityScopes, the loopback caller acts as the proxy), sends one RPC and
// prints the response. HOLD_MS keeps the connection open like a live browser tab.
// Usage (from repo root):
//   node --import ./scripts/tsx.mjs qa/rfc0039-foreground/ws-client.mts <port> <identity> <method> '<params>'
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION } from "../../packages/gateway-protocol/src/index.js";

const [portArg, identity, method, paramsJson] = process.argv.slice(2);
const origin = "https://control.example.test";
const ws = new WebSocket(`ws://127.0.0.1:${portArg}`, {
  headers: {
    origin,
    "x-forwarded-for": "203.0.113.50",
    "x-forwarded-proto": "https",
    "x-forwarded-user": identity,
  },
});

type ResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: { auth?: { scopes?: unknown }; scopes?: unknown } & Record<string, unknown>;
  error?: unknown;
};

function req(m: string, params: unknown): Promise<ResponseFrame> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${m}`)), 60_000);
    const onMessage = (data: Buffer) => {
      const frame = JSON.parse(String(data));
      if (frame.type === "res" && frame.id === id) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(frame);
      }
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type: "req", id, method: m, params }));
  });
}

// While a tab is held open, show chat events so visible rejections can be observed.
function chatText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((c: { text?: string }) => c?.text ?? "").join(" ");
  }
  return "";
}

ws.on("message", (data: Buffer) => {
  if (!process.env.HOLD_MS) {
    return;
  }
  try {
    const frame = JSON.parse(String(data));
    if (frame.type === "event" && frame.event === "chat") {
      const p = frame.payload ?? {};
      const text = chatText(p.message?.content);
      if (p.state === "final" || p.state === "error") {
        const error = p.errorMessage
          ? ` error=${JSON.stringify(String(p.errorMessage).slice(0, 160))}`
          : "";
        console.log(
          `# chat-event run=${p.runId} state=${p.state} text=${JSON.stringify(text.slice(0, 160))}${error}`,
        );
      }
    }
  } catch {}
});
ws.once("error", (err) => {
  console.log(JSON.stringify({ transportError: String(err) }));
  process.exit(3);
});
ws.once("open", () => {
  void run();
});

async function run(): Promise<void> {
  try {
    const hello = await req("connect", {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: { id: "openclaw-control-ui", version: "proof", platform: "web", mode: "webchat" },
      caps: [],
      commands: [],
      role: "operator",
      scopes: [],
    });
    if (!hello.ok) {
      console.log(JSON.stringify({ connect: "failed", error: hello.error }, null, 2));
      process.exit(2);
    }
    const scopes = hello.payload?.auth?.scopes ?? hello.payload?.scopes;
    console.log(`# connected as ${identity}; scopes=${JSON.stringify(scopes ?? null)}`);
    const res = await req(method, JSON.parse(paramsJson ?? "{}"));
    console.log(
      JSON.stringify(
        res.ok ? { ok: true, payload: res.payload } : { ok: false, error: res.error },
        null,
        2,
      ),
    );
    // HOLD_MS keeps the authenticated connection open like a live browser tab.
    const holdMs = Number(process.env.HOLD_MS ?? 0);
    if (holdMs > 0) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, holdMs);
        ws.once("close", () => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
    }
    ws.close();
    process.exit(res.ok ? 0 : 1);
  } catch (err) {
    console.log(JSON.stringify({ clientError: String(err) }));
    process.exit(4);
  }
}
