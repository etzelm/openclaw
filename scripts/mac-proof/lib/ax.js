// Accessibility helper for the proof scenarios (JXA, run through osascript).
// Usage: osascript -l JavaScript ax.js <bundle-id> <verb> [args...]
//   wait-window <seconds>          exit 0 once the app has a window
//   frame <role> <text>            JSON frame/center of the first match
//   screen-frame <role> <text>     JSON frame/center in screen coordinates
//   press <role> <text>            AXPress the first match
//   press-lowest <role> <text>     AXPress the match lowest on screen
//   value <role> <text>            AXValue of the first match
//   exists <role> <text>           exit 0 if a match exists
//   menu <item-title>              click the first menu bar item with that title
//   dump <path>                    write the front window's AX tree as JSON
// <role> is an AX role such as AXButton, AXLink, AXTextField, or "*".
// <text> matches name, description, title, value or help (substring, case-insensitive).
// Optional last arg <scope>: "native" skips elements inside an AXWebArea (AppKit
// controls), "web" keeps only elements inside one (Control UI or page content).
//
// WebKit reports AXPosition for elements inside an AXWebArea relative to that
// web area, not the screen. screen-frame adds the nearest AXWebArea origin, so a
// HID click lands on the element instead of above it by the window's content
// offset (the defect in run 40561143504).

function run(argv) {
  const [bundleId, verb, ...rest] = argv;
  const se = Application("System Events");
  let procs = se.processes.whose({ bundleIdentifier: bundleId });
  if (verb === "wait-window") {
    // System Events can list a just-launched app a few seconds after pgrep does.
    for (let i = 0; i < 60 && procs.length === 0; i++) {
      delay(0.5);
      procs = se.processes.whose({ bundleIdentifier: bundleId });
    }
  }
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

  function* walk(el, depth, inWeb, webOrigin) {
    if (depth > 40) return;
    const role = attr(el, "AXRole");
    const isWeb = role === "AXWebArea";
    const origin = isWeb ? (attr(el, "AXPosition") || [0, 0]) : webOrigin;
    yield [el, inWeb, origin];
    const kids = safe(() => el.uiElements()) || [];
    for (const kid of kids) yield* walk(kid, depth + 1, inWeb || isWeb, origin);
  }

  function matches(el, role, needle) {
    if (role !== "*" && attr(el, "AXRole") !== role) return false;
    if (!needle) return true;
    return texts(el).some((t) => t.toLowerCase().includes(needle));
  }

  function find(role, text, scope, lowest) {
    const needle = (text || "").toLowerCase();
    let hit = null;
    let hitY = -Infinity;
    for (const win of proc.windows()) {
      for (const [el, inWeb, origin] of walk(win, 0, false, [0, 0])) {
        if (scope === "native" && inWeb) continue;
        if (scope === "web" && !inWeb) continue;
        if (!matches(el, role, needle)) continue;
        if (!lowest) return [el, inWeb, origin];
        const pos = attr(el, "AXPosition") || [0, 0];
        const y = (inWeb ? origin[1] : 0) + pos[1];
        if (y > hitY) {
          hitY = y;
          hit = [el, inWeb, origin];
        }
      }
    }
    return hit;
  }

  function screenFrame(el, inWeb, origin) {
    const [x, y] = attr(el, "AXPosition") || [0, 0];
    const [w, h] = attr(el, "AXSize") || [0, 0];
    const sx = (inWeb ? origin[0] : 0) + x;
    const sy = (inWeb ? origin[1] : 0) + y;
    return { x: sx, y: sy, w, h, cx: sx + w / 2, cy: sy + h / 2 };
  }

  switch (verb) {
    case "wait-window": {
      const limit = Number(rest[0] || 30);
      for (let i = 0; i < limit * 2; i++) {
        // A process that is still launching can throw "Invalid index" here.
        try {
          if (proc.windows().length > 0) return "ok";
        } catch (_) {}
        delay(0.5);
      }
      throw new Error("no window");
    }
    case "frame": {
      const hit = find(rest[0], rest[1], rest[2], false);
      if (!hit) throw new Error(`no ${rest[0]} matching ${rest[1]}`);
      const [x, y] = attr(hit[0], "AXPosition");
      const [w, h] = attr(hit[0], "AXSize");
      return JSON.stringify({ x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
    }
    case "screen-frame": {
      const hit = find(rest[0], rest[1], rest[2], false);
      if (!hit) throw new Error(`no ${rest[0]} matching ${rest[1]}`);
      return JSON.stringify(screenFrame(hit[0], hit[1], hit[2]));
    }
    case "press": {
      const hit = find(rest[0], rest[1], rest[2], false);
      if (!hit) throw new Error(`no ${rest[0]} matching ${rest[1]}`);
      hit[0].actions.byName("AXPress").perform();
      return "pressed";
    }
    case "press-lowest": {
      const hit = find(rest[0], rest[1], rest[2], true);
      if (!hit) throw new Error(`no ${rest[0]} matching ${rest[1]}`);
      const frame = screenFrame(hit[0], hit[1], hit[2]);
      hit[0].actions.byName("AXPress").perform();
      return JSON.stringify(frame);
    }
    case "value": {
      const hit = find(rest[0], rest[1], rest[2], false);
      if (!hit) throw new Error(`no ${rest[0]} matching ${rest[1]}`);
      return String(attr(hit[0], "AXValue") || "");
    }
    case "set-value": {
      const hit = find(rest[0], rest[1], rest[2], false);
      if (!hit) throw new Error(`no ${rest[0]} matching ${rest[1]}`);
      const value = rest[3] ?? "";
      safe(() => { hit[0].attributes.byName("AXValue").value = value; });
      return String(attr(hit[0], "AXValue") || "");
    }
    case "focus-tab": {
      // Press Tab until the element reports AXFocused; returns the Tab count or
      // "not-focused". Keystrokes reach the app on the hosted runner, while HID
      // clicks and AXFocused/AXPress do not move DOM focus into web fields.
      const hit = find(rest[0], rest[1], rest[2], false);
      if (!hit) throw new Error(`no ${rest[0]} matching ${rest[1]}`);
      const limit = Number(rest[3] || 80);
      const seApp = Application("System Events");
      for (let i = 0; i < limit; i++) {
        if (attr(hit[0], "AXFocused") === true) return String(i);
        seApp.keyCode(48);
        delay(0.2);
      }
      return attr(hit[0], "AXFocused") === true ? String(limit) : "not-focused";
    }
    case "exists": {
      if (!find(rest[0], rest[1], rest[2], false)) throw new Error("absent");
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
        for (const [el, inWeb] of walk(win, 0, false, [0, 0])) {
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
