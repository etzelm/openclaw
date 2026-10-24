// STUB of Anthropic's GET /api/oauth/profile for the harness. It never sees a real token:
// synthetic tokens are "synthetic-<account>[~n]" and attest to "<account>". The mode file
// selects ok | 401 | 500 | timeout (holds the request open until the client gives up), and can
// change between turns. Every request is logged with the account its token names.
import fs from "node:fs";
import http from "node:http";
const [modeFile, logFile, portFile] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  const mode = fs.existsSync(modeFile) ? fs.readFileSync(modeFile, "utf8").trim() : "ok";
  const bearer = String(req.headers.authorization ?? "");
  const tokenAccount = bearer.startsWith("Bearer synthetic-")
    ? bearer.slice("Bearer synthetic-".length).replace(/~\d+$/, "")
    : null;
  const entry = { at: new Date().toISOString(), event: "profile-request", path: req.url, mode, tokenAccount };
  if (req.url !== "/api/oauth/profile" || mode === "timeout") {
    fs.appendFileSync(logFile, JSON.stringify({ ...entry, status: "held" }) + "\n");
    req.on("close", () => res.destroy());
    return;
  }
  const status = mode === "401" || !tokenAccount ? 401 : mode === "500" ? 500 : 200;
  fs.appendFileSync(logFile, JSON.stringify({ ...entry, status }) + "\n");
  res.writeHead(status, { "content-type": "application/json" });
  res.end(
    JSON.stringify(
      status === 200
        ? {
            account: { uuid: tokenAccount, email: `${tokenAccount}@example.invalid` },
            organization: { uuid: "org-harness" },
          }
        : { type: "error", error: { type: "authentication_error", message: "stub" } },
    ),
  );
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(portFile, String(server.address().port)));
