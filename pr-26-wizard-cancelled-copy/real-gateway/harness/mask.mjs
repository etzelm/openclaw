// Scratch: paint over the one-time device code in pending screenshots. Usage: node mask.mjs <dir>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const dir = process.argv[2];
const boxes = {
  "model-setup-openai-device-code-pending": { x: 534, y: 312, w: 212, h: 54 },
  "custodian-pending": { x: 534, y: 223, w: 212, h: 54 },
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const arm of ["before", "after"]) {
  for (const [name, b] of Object.entries(boxes)) {
    const file = path.join(dir, `${arm}-${name}.png`);
    const data = readFileSync(file).toString("base64");
    await page.setContent(
      `<body style="margin:0"><img src="data:image/png;base64,${data}" style="display:block">` +
        `<div style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:#444;color:#fff;` +
        `font:600 14px sans-serif;display:flex;align-items:center;justify-content:center">one-time code redacted</div></body>`,
    );
    writeFileSync(file, await page.screenshot());
    console.log("masked", file);
  }
}
await browser.close();
