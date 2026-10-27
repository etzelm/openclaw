// Loopback HTTP fixture for the proof scenarios. Every request is appended to
// a JSONL file (time, path, user agent) so a scenario can count page loads and
// show which browser opened a link.
// Usage: node fixture-server.mjs <port> <hits.jsonl>
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.argv[2]);
const hitsPath = process.argv[3];

const page = (title, body = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body style="font:24px -apple-system;padding:40px"><h1>${title}</h1>${body}</body></html>`;

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname !== "/health") {
    appendFileSync(
      hitsPath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        port,
        path: url.pathname,
        ua: req.headers["user-agent"] ?? "",
      })}\n`,
    );
  }
  if (url.pathname === "/health") {
    res.writeHead(200).end("ok");
  } else if (url.pathname === "/widget") {
    // Allowed widget link: record the browser hit, then land on the public
    // address the review names.
    res.writeHead(302, { location: "https://example.com/widget" }).end();
  } else {
    const links = '<p><a href="/page/b">to page b</a></p>';
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
      .end(page(`fixture ${url.pathname}`, links));
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`fixture listening on 127.0.0.1:${port}`);
});
