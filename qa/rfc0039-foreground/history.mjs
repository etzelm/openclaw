// Reads a chat.history RPC response on stdin.
//   node history.mjs <label>             prints a compact transcript
//   node history.mjs --count <pattern>   prints how many "role:text" lines match the pattern
const chunks = [];
process.stdin.on("data", (chunk) => {
  chunks.push(String(chunk));
});
process.stdin.on("end", () => {
  const messages = parseMessages(chunks.join(""));
  const text = (message) => {
    const content = message?.content ?? message?.message?.content;
    if (typeof content === "string") {
      return content;
    }
    return Array.isArray(content) ? content.map((part) => part?.text ?? "").join(" ") : "";
  };
  const role = (message) => message?.role ?? message?.message?.role;
  const lines = messages.map((message) => `${role(message)}:${text(message).replace(/\s+/g, " ")}`);
  if (process.argv[2] === "--count") {
    const pattern = new RegExp(`^(?:${process.argv[3]})`, "u");
    process.stdout.write(String(lines.filter((line) => pattern.test(line)).length));
    return;
  }
  console.log(`HISTORY ${process.argv[2] ?? ""} messages=${lines.length}`);
  for (const line of lines) {
    console.log(`  ${line.slice(0, 140)}`);
  }
});

function parseMessages(input) {
  try {
    const parsed = JSON.parse(input);
    return parsed.payload?.messages ?? parsed.payload?.entries ?? parsed.payload?.items ?? [];
  } catch {
    return [];
  }
}
