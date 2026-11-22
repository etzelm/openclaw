// Counts entries in the stub model's request log.
//   node stub-count.mjs <log> requests <marker>   model requests whose newest prompt carries the marker
//   node stub-count.mjs <log> seen <marker>       model requests that contain the marker anywhere
import fs from "node:fs";

const [logPath, kind, marker] = process.argv.slice(2);

function readLines(path) {
  try {
    return fs.readFileSync(path, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

let count = 0;
for (const line of readLines(logPath)) {
  const entry = JSON.parse(line);
  if (entry.event) {
    continue;
  }
  if (kind === "requests" && entry.marker === marker) {
    count += 1;
  }
  if (kind === "seen" && Array.isArray(entry.seen) && entry.seen.includes(marker)) {
    count += 1;
  }
}
process.stdout.write(String(count));
