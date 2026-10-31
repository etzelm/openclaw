// Accessibility helper for the proof scenarios (JXA, run through osascript).
// Usage: osascript -l JavaScript ax.js <bundle-id|pid:N> <verb> [args...]
//   wait-window <seconds>          exit 0 once the app has a window
//   frame <role> <text>            JSON frame/center of the first match
//   screen-frame <role> <text>     JSON frame/center in screen coordinates
//   press <role> <text>            AXPress the first match
//   press-lowest <role> <text>     AXPress the match lowest on screen
//   value <role> <text>            AXValue of the first match
//   set-value <role> <text> <scope> <value>
//   focus-tab <role> <text> <scope> [limit]
//   exists <role> <text>           exit 0 if a match exists
//   menu <item-title>              press the first menu bar item with that title
//   dump <path>                    write the app's AX tree as JSON
//   pid                            print the target pid
//   window-frame                   x,y,w,h of the app's first window (screen points)
//   frontmost                      exit 0 if the target is the frontmost app
//   raise [seconds]                bring the target to the front; prints the frontmost app
// <role> is an AX role such as AXButton, AXLink, AXTextField, or "*".
// <text> matches title, description, value, help or role description
// (substring, case-insensitive). Optional <scope>: "native" skips elements inside
// an AXWebArea (AppKit controls), "web" keeps only elements inside one.
//
// The target is resolved to one pid (NSRunningApplication by bundle id) and read
// through the AXUIElement API for that pid. System Events resolves processes by
// name, so with two apps named OpenClaw running (a daily app beside the PR build)
// it read and pressed the wrong one.
//
// WebKit reports AXPosition for elements inside an AXWebArea relative to that
// web area, not the screen. screen-frame adds the nearest AXWebArea origin, so a
// HID click lands on the element instead of above it by the window's content
// offset (the defect in run 40561143504).
ObjC.import("AppKit");
ObjC.import("ApplicationServices");

function resolvePid(target) {
  if (target.startsWith("pid:")) return Number(target.slice(4));
  const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier($(target));
  if (apps.count === 0) return null;
  if (apps.count > 1) throw new Error(`more than one ${target} running`);
  return apps.objectAtIndex(0).processIdentifier;
}

function rawAttr(el, name) {
  const ref = Ref();
  if ($.AXUIElementCopyAttributeValue(el, $(name), ref) !== 0 || !ref[0]) return null;
  return ObjC.castRefToObject(ref[0]);
}

function attr(el, name) {
  const v = rawAttr(el, name);
  if (v === null) return null;
  const cls = ObjC.unwrap(v.className);
  if (cls.includes("Boolean")) return ObjC.unwrap(v) ? true : false;
  if (v.isKindOfClass($.NSString) || v.isKindOfClass($.NSNumber)) return ObjC.unwrap(v);
  if (v.isKindOfClass($.NSArray)) {
    const out = [];
    for (let i = 0; i < v.count; i++) out.push(v.objectAtIndex(i));
    return out;
  }
  // AXValue (CGPoint/CGSize): parse its description, e.g. "{value = x:1 y:2 ...}".
  const d = ObjC.unwrap(v.description) || "";
  let m = d.match(/x:(-?[\d.]+) y:(-?[\d.]+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = d.match(/w:(-?[\d.]+) h:(-?[\d.]+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  return null;
}

function run(argv) {
  const [target, verb, ...rest] = argv;
  let pid = resolvePid(target);
  if (verb === "wait-window") {
    // LaunchServices can list a just-launched app a few seconds after pgrep does.
    for (let i = 0; i < 60 && !pid; i++) {
      delay(0.5);
      pid = resolvePid(target);
    }
  }
  if (!pid) throw new Error(`process ${target} not running`);
  const app = $.AXUIElementCreateApplication(pid);

  const texts = (el) =>
    ["AXTitle", "AXDescription", "AXValue", "AXHelp", "AXRoleDescription"]
      .map((n) => attr(el, n))
      .filter((v) => typeof v === "string" && v.length > 0);
  const windows = () => attr(app, "AXWindows") || [];

  function* walk(el, depth, inWeb, webOrigin) {
    if (depth > 40) return;
    const role = attr(el, "AXRole");
    const isWeb = role === "AXWebArea";
    const origin = isWeb ? (attr(el, "AXPosition") || [0, 0]) : webOrigin;
    yield [el, inWeb, origin];
    for (const kid of attr(el, "AXChildren") || []) yield* walk(kid, depth + 1, inWeb || isWeb, origin);
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
    for (const win of windows()) {
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

  const press = (el) => {
    const err = $.AXUIElementPerformAction(el, $("AXPress"));
    if (err !== 0) throw new Error(`AXPress failed (${err})`);
  };
  const need = (hit) => {
    if (!hit) throw new Error(`no ${rest[0]} matching ${rest[1]}`);
    return hit;
  };
  const frontmost = () => $.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier === pid;

  switch (verb) {
    case "pid":
      return String(pid);
    case "window-frame": {
      // Largest standard window; launch can briefly show a small system dialog first.
      let best = null;
      for (const win of windows()) {
        if (attr(win, "AXSubrole") !== "AXStandardWindow") continue;
        const [x, y] = attr(win, "AXPosition") || [0, 0];
        const [w, h] = attr(win, "AXSize") || [0, 0];
        if (!best || w * h > best[2] * best[3]) best = [x, y, w, h];
      }
      if (!best) throw new Error("no standard window");
      return best.map(Math.round).join(",");
    }
    case "frontmost":
      if (!frontmost()) throw new Error("not frontmost");
      return "frontmost";
    case "raise": {
      // On hosted macos-26, `activate` alone left another app frontmost (run
      // 40812904893). Proof 6 reached frontmost=OpenClaw there by setting the
      // System Events process frontmost, then AXRaise and AXMain on the window
      // (runs 41182008780, 41184996689). Same steps, with the process chosen by pid.
      const se = Application("System Events");
      const procs = se.processes.whose({ unixId: pid });
      if (procs.length === 0) throw new Error(`System Events has no process ${pid}`);
      try { procs[0].frontmost = true; } catch (e) {}
      const wins = windows();
      const win = wins.find((w) => attr(w, "AXSubrole") === "AXStandardWindow") || wins[0];
      if (win) {
        $.AXUIElementPerformAction(win, $("AXRaise"));
        $.AXUIElementSetAttributeValue(win, $("AXMain"), $.kCFBooleanTrue);
      }
      const limit = Number(rest[0] || 10);
      for (let i = 0; i < limit * 2 && !frontmost(); i++) delay(0.5);
      const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
      const name = front ? `${ObjC.unwrap(front.bundleIdentifier)} pid ${front.processIdentifier}` : "none";
      if (!frontmost()) throw new Error(`still not frontmost; frontmost is ${name}`);
      return `frontmost (${name})`;
    }
    case "wait-window": {
      const limit = Number(rest[0] || 30);
      for (let i = 0; i < limit * 2; i++) {
        if (windows().length > 0) return "ok";
        delay(0.5);
      }
      throw new Error("no window");
    }
    case "frame": {
      const [el] = need(find(rest[0], rest[1], rest[2], false));
      const [x, y] = attr(el, "AXPosition");
      const [w, h] = attr(el, "AXSize");
      return JSON.stringify({ x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
    }
    case "screen-frame": {
      const hit = need(find(rest[0], rest[1], rest[2], false));
      return JSON.stringify(screenFrame(hit[0], hit[1], hit[2]));
    }
    case "press": {
      press(need(find(rest[0], rest[1], rest[2], false))[0]);
      return "pressed";
    }
    case "press-lowest": {
      const hit = need(find(rest[0], rest[1], rest[2], true));
      const frame = screenFrame(hit[0], hit[1], hit[2]);
      press(hit[0]);
      return JSON.stringify(frame);
    }
    case "value": {
      const [el] = need(find(rest[0], rest[1], rest[2], false));
      return String(attr(el, "AXValue") || "");
    }
    case "set-value": {
      const [el] = need(find(rest[0], rest[1], rest[2], false));
      $.AXUIElementSetAttributeValue(el, $("AXValue"), $(rest[3] ?? ""));
      return String(attr(el, "AXValue") || "");
    }
    case "focus-tab": {
      // Press Tab until the element reports AXFocused; returns the Tab count or
      // "not-focused". Keys go to the frontmost app, so require the target there.
      const [el] = need(find(rest[0], rest[1], rest[2], false));
      const limit = Number(rest[3] || 80);
      const seApp = Application("System Events");
      for (let i = 0; i < limit; i++) {
        if (attr(el, "AXFocused") === true) return String(i);
        if (!frontmost()) throw new Error("target lost focus; refusing to send Tab");
        seApp.keyCode(48);
        delay(0.2);
      }
      return attr(el, "AXFocused") === true ? String(limit) : "not-focused";
    }
    case "exists": {
      if (!find(rest[0], rest[1], rest[2], false)) throw new Error("absent");
      return "present";
    }
    case "menu": {
      const title = rest[0];
      const bar = rawAttr(app, "AXMenuBar");
      for (const top of (bar && attr(bar, "AXChildren")) || []) {
        for (const menu of attr(top, "AXChildren") || []) {
          for (const item of attr(menu, "AXChildren") || []) {
            if (attr(item, "AXTitle") === title) {
              press(item);
              return `clicked ${attr(top, "AXTitle")} > ${title}`;
            }
          }
        }
      }
      throw new Error(`no menu item ${title}`);
    }
    case "dump": {
      const out = [];
      for (const win of windows()) {
        for (const [el, inWeb] of walk(win, 0, false, [0, 0])) {
          out.push({ role: attr(el, "AXRole"), web: inWeb, texts: texts(el), pos: attr(el, "AXPosition") });
          if (out.length > 4000) break;
        }
      }
      $(JSON.stringify(out, null, 1)).writeToFileAtomicallyEncodingError(rest[0], true, $.NSUTF8StringEncoding, null);
      return `dumped ${out.length} (pid ${pid})`;
    }
    default:
      throw new Error(`unknown verb ${verb}`);
  }
}
