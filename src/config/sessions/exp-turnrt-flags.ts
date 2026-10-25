// exp only: OCX_TURNRT="1,2,3,4" enables each fresh-turn experiment; unset = main behavior.
const enabled = new Set((process.env.OCX_TURNRT ?? "").split(",").map((part) => part.trim()));
export function turnRtExperiment(id: 1 | 2 | 3 | 4): boolean {
  return enabled.has(String(id)) || enabled.has("all");
}
