// Accessibility helper for the proof scenarios (JXA, run through osascript).
// Usage: osascript -l JavaScript ax.js <bundle-id> <verb> [args...]
//   wait-window <seconds>          exit 0 once the app has a window
//   frame <role> <text>            JSON frame/center of the first match
//   press <role> <text>            AXPress the first match
//   exists <role> <text>           exit 0 if a match exists
//   menu <item-title>              click the first menu bar item with that title
//   dump <path>                    write the front window's AX tree as JSON
// <role> is an AX role such as AXButton, AXLink, AXTextField, or "*".
// <text> matches name, description, title, value or help (substring, case-insensitive).
// Optional last arg <scope>: "native" skips elements inside an AXWebArea (AppKit
// controls), "web" keeps only elements inside one (Control UI or page content).

function run(argv) {
  const [bundleId, verb, ...rest] = argv;
  const se = Application("System Events");
  const procs = se.processes.whose({ bundleIdentifier: bundleId });
  if (procs.length === 0) throw new Error(`process ${bundleId} not running`);
  const proc = procs[0];

  const attr = (el, name) => {
    try {
      return el.attributes.byName(name).value();
    } catch (_) {
      return null;
    }
  };
  const texts = (el) =>
    ["AXTitle", "AXDescription", "AXValue", "AXHelp", "AXRoleDescription"]
      .map((n) => attr(el, n))
      .concat([safe(() => el.name())])
      .filter((v) => typeof v === "string" && v.length > 0);
  const safe = (fn) => {
    try {
      return fn();
    } catch (_) {
      return null;
    }
  };

  function* walk(el, depth, inWeb) {
    if (depth > 40) return;
    const web = inWeb || attr(el, "AXRole") === "AXWebArea";
    yield [el, inWeb];
    const kids = safe(() => el.uiElements()) || [];
    for (const kid of kids) yield* walk(kid, depth + 1, web);
  }

  function find(role, text, scope) {
    const needle = (text || "").toLowerCase();
    for (const win of proc.windows()) {
      for (const [el, inWeb] of walk(win, 0, false)) {
        if (scope === "native" && inWeb) continue;
        if (scope === "web" && !inWeb) continue;
        const r = attr(el, "AXRole");
        if (role !== "*" && r !== role) continue;
        if (!needle || texts(el).some((t) => t.toLowerCase().includes(needle))) return el;
      }
    }
    return null;
  }

  switch (verb) {
    case "wait-window": {
      const limit = Number(rest[0] || 30);
      for (let i = 0; i < limit * 2; i++) {
        if (proc.windows().length > 0) return "ok";
        delay(0.5);
      }
      throw new Error("no window");
    }
    case "frame": {
      const el = find(rest[0], rest[1], rest[2]);
      if (!el) throw new Error(`no ${rest[0]} matching ${rest[1]}`);
      const [x, y] = attr(el, "AXPosition");
      const [w, h] = attr(el, "AXSize");
      return JSON.stringify({ x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
    }
    case "press": {
      const el = find(rest[0], rest[1], rest[2]);
      if (!el) throw new Error(`no ${rest[0]} matching ${rest[1]}`);
      el.actions.byName("AXPress").perform();
      return "pressed";
    }
    case "exists": {
      if (!find(rest[0], rest[1], rest[2])) throw new Error("absent");
      return "present";
    }
    case "menu": {
      const title = rest[0];
      for (const bar of proc.menuBars()) {
        for (const top of bar.menuBarItems()) {
          for (const menu of safe(() => top.menus()) || []) {
            for (const item of menu.menuItems()) {
              if (safe(() => item.name()) === title) {
                item.click();
                return `clicked ${safe(() => top.name())} > ${title}`;
              }
            }
          }
        }
      }
      throw new Error(`no menu item ${title}`);
    }
    case "dump": {
      const out = [];
      for (const win of proc.windows()) {
        for (const [el, inWeb] of walk(win, 0, false)) {
          out.push({ role: attr(el, "AXRole"), web: inWeb, texts: texts(el), pos: attr(el, "AXPosition") });
          if (out.length > 4000) break;
        }
      }
      const app = Application.currentApplication();
      app.includeStandardAdditions = true;
      const path = rest[0];
      const file = app.openForAccess(Path(path), { writePermission: true });
      app.setEof(file, { to: 0 });
      app.write(JSON.stringify(out, null, 1), { to: file, startingAt: 0 });
      app.closeAccess(file);
      return `dumped ${out.length}`;
    }
    default:
      throw new Error(`unknown verb ${verb}`);
  }
}
