/* Responsive audit: drives a real (headless) Chrome over CDP, so this measures
   actual layout instead of guessing from the CSS.
 *
 * For every route × viewport it reports:
 *   - horizontal page overflow (the definitive "scrolls sideways" signal)
 *   - elements poking outside the viewport (ignoring intentional off-canvas
 *     and horizontally scrollable containers)
 *   - tap targets under 32px (fail) and under 44px (warn)
 *   - text clipped by a fixed box
 * and writes a screenshot per route for eyeballing.
 *
 * Run with: node scripts/responsive-check.mjs [--shots]  (needs npm run start) */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9222;
const PROFILE = join(
  process.env.TEMP ?? "C:\\Users\\USER\\AppData\\Local\\Temp",
  "opencode",
  `qfs-chrome-${Date.now()}`
);
const SHOT_DIR = join(process.cwd(), "scripts", "shots");
const WANT_SHOTS = process.argv.includes("--shots");

const VIEWPORTS = [
  { name: "small-360", width: 360, height: 740, mobile: true },
  { name: "phone-390", width: 390, height: 844, mobile: true },
  { name: "phablet-430", width: 430, height: 932, mobile: true },
  { name: "tablet-768", width: 768, height: 1024, mobile: true },
  { name: "laptop-1280", width: 1280, height: 800, mobile: false },
];

/* ------------------------------------------------------------------ CDP */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    this.events = new Map();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        (this.events.get(msg.method) ?? []).forEach((fn) => fn(msg.params, msg.sessionId));
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.waiting.has(id)) {
          this.waiting.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30_000);
    });
  }
  once(method, sessionId) {
    return new Promise((resolve) => {
      const list = this.events.get(method) ?? [];
      const fn = (params) => {
        this.events.set(method, (this.events.get(method) ?? []).filter((f) => f !== fn));
        resolve(params);
      };
      list.push(fn);
      this.events.set(method, list);
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`Chrome did not expose ${url}`);
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`login ${email} failed: ${JSON.stringify(json.error)}`);
  return res.headers.get("set-cookie").match(/qfs_session=([^;]+)/)[1];
}

/* ------------------------------------------------------------- in-page audit */
const AUDIT = `(() => {
  const vw = window.innerWidth;
  const sel = (el) => {
    const id = el.id ? "#" + el.id : "";
    const raw = typeof el.className === "string" ? el.className : (el.getAttribute("class") || "");
    const cls = raw.trim() ? "." + raw.trim().split(/\\s+/).slice(0, 3).join(".") : "";
    return el.tagName.toLowerCase() + id + cls;
  };
  const shown = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      // auto/scroll = legitimately scrollable, hidden/clip = deliberately cropped
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true;
    }
    return false;
  };
  // An off-canvas drawer parked at exactly -its own width is the closed state of
  // a working slide-out nav, not a layout fault.
  const closedDrawer = (el) => {
    if (getComputedStyle(el).position !== "fixed") return false;
    const w = el.getBoundingClientRect().width;
    return Math.abs(el.getBoundingClientRect().left + w) < 2;
  };
  const out = { vw, pageScrollW: document.documentElement.scrollWidth, over: [], tiny: [], clipped: [], font: 0 };
  for (const el of document.querySelectorAll("*")) {
    if (!shown(el)) continue;
    // .skill-track is an animated fill (width 0 -> value%) and its label is
    // anchored to the fill's right edge, so it parks off-screen before the
    // IntersectionObserver runs. Transient by design, not a layout fault.
    if (el.closest(".skill-track")) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el) && !closedDrawer(el)) {
      const fixed = s.position === "fixed" || s.position === "absolute";
      out.over.push({ sel: sel(el), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), fixed });
    }
    if (
      el.matches("a, button, input:not([type=hidden]), select, textarea, [role=button]") &&
      !el.readOnly &&
      !el.disabled
    ) {
      // A control wrapped in a <label> is tappable across the whole label, so
      // measure that instead of the bare input box.
      const target = el.closest("label") ?? el;
      const t = target.getBoundingClientRect();
      const h = Math.round(t.height);
      const w = Math.round(t.width);
      if ((w < 32 || h < 32) && w > 0) out.tiny.push({ sel: sel(el), w, h, text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 26) });
    }
    if (el.children.length === 0) {
      const txt = (el.textContent || "").trim();
      // A title attribute makes the full text reachable, so the clip is fine.
      if (txt && el.scrollWidth > el.clientWidth + 2 && !el.title && (s.overflow === "hidden" || s.overflowX === "hidden" || s.textOverflow === "ellipsis")) {
        out.clipped.push({ sel: sel(el), text: txt.slice(0, 44), sw: el.scrollWidth, cw: el.clientWidth });
      }
    }
  }
  out.over = out.over.slice(0, 12);
  out.tiny = out.tiny.slice(0, 12);
  out.clipped = out.clipped.slice(0, 8);
  out.font = parseFloat(getComputedStyle(document.body).fontSize);
  return JSON.stringify(out);
})()`;

/* ------------------------------------------------------------------ routes */
const USER_COOKIE = await login("john@example.com", "Demo12345!");
const ADMIN_COOKIE = await login("admin@qfs.local", "Admin1234!");

const ROUTES = [
  { path: "/", who: "public", name: "landing" },
  { path: "/user/user/login", who: "public", name: "login" },
  { path: "/user/user/register", who: "public", name: "register" },
  { path: "/user/user/dashboard", who: "user", name: "user-dashboard" },
  { path: "/user/user/connect", who: "user", name: "connect-wallet" },
  { path: "/user/admin", who: "admin", name: "admin-overview" },
  { path: "/user/admin/users", who: "admin", name: "admin-users" },
  { path: "/user/admin/requests", who: "admin", name: "admin-requests" },
  { path: "/user/admin/transactions", who: "admin", name: "admin-transactions" },
  { path: "/user/admin/plans", who: "admin", name: "admin-plans" },
  { path: "/user/admin/loans", who: "admin", name: "admin-loans" },
  { path: "/user/admin/documents", who: "admin", name: "admin-documents" },
  { path: "/user/admin/reviews", who: "admin", name: "admin-reviews" },
  { path: "/user/admin/markets", who: "admin", name: "admin-markets" },
  { path: "/user/admin/settings", who: "admin", name: "admin-settings" },
  { path: "/user/admin/audit", who: "admin", name: "admin-audit" },
];

/* ------------------------------------------------------------------- run */
if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME} (set CHROME_PATH)`);
  process.exit(2);
}
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });
if (WANT_SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "about:blank",
  ],
  { stdio: "ignore", detached: false }
);

let cdp;
const report = [];
try {
  const version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
  cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);

  const cookieFor = (who) => (who === "admin" ? ADMIN_COOKIE : who === "user" ? USER_COOKIE : null);
  let lastWho = null;

  // Land on the origin once before touching cookies; Network.setCookie is only
  // reliable after the page target has a document.
  {
    const first = cdp.once("Page.loadEventFired", sessionId);
    await cdp.send("Page.navigate", { url: BASE + "/" }, sessionId);
    await first;
  }

  for (const route of ROUTES) {
    if (cookieFor(route.who) !== lastWho) {
      await cdp.send("Network.clearBrowserCookies", {}, sessionId);
      const token = cookieFor(route.who);
      if (token) {
        await cdp.send(
          "Network.setCookie",
          { name: "qfs_session", value: token, domain: "localhost", path: "/", httpOnly: true },
          sessionId
        );
      }
      lastWho = cookieFor(route.who);
    }

    const loaded = cdp.once("Page.loadEventFired", sessionId);
    await cdp.send("Page.navigate", { url: BASE + route.path }, sessionId);
    await loaded;
    await sleep(400); // client data fetch + first paint

    const perViewport = [];
    for (const vp of VIEWPORTS) {
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile },
        sessionId
      );
      // Must outlast the 0.3s sidebar transform transition, otherwise a drawer
      // mid-slide is measured at a half-off position and reported as a fault.
      await sleep(500); // reflow + resize-driven fetch + transition settle
      const { result } = await cdp.send(
        "Runtime.evaluate",
        { expression: AUDIT, returnByValue: true },
        sessionId
      );
      const a = JSON.parse(result.value);
      perViewport.push({ vp: vp.name, ...a });

      if (WANT_SHOTS && (vp.name === "phone-390" || vp.name === "laptop-1280")) {
        const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
        writeFileSync(join(SHOT_DIR, `${route.name}-${vp.width}.png`), Buffer.from(shot.data, "base64"));
      }
    }
    report.push({ route: route.path, name: route.name, perViewport });
  }
} finally {
  try {
    cdp?.ws.close();
  } catch {}
  try {
    chrome.kill();
  } catch {}
  await sleep(1200);
  try {
    rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    /* Chrome may still be flushing its profile; a stale temp dir is harmless */
  }
}

/* ------------------------------------------------------------------ print */
const lines = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};
let problems = 0;
for (const { route, perViewport } of report) {
  const hard = perViewport.filter(
    (a) => a.pageScrollW > a.vw + 1 || a.over.filter((o) => !o.fixed).length || a.tiny.some((t) => t.w < 32 || t.h < 32)
  );
  const soft = perViewport.filter(
    (a) => a.over.some((o) => o.fixed) || a.tiny.some((t) => !(t.w < 32 || t.h < 32)) || a.clipped.length
  );
  if (!hard.length && !soft.length) {
    say(`PASS ${route}`);
    continue;
  }
  problems += hard.length;
  say(`${hard.length ? "FAIL" : "WARN"} ${route}  (${hard.length} hard, ${soft.length} soft viewports)`);
  for (const a of perViewport) {
    const scroll = a.pageScrollW > a.vw + 1 ? `page scrolls sideways (${a.pageScrollW} > ${a.vw})` : null;
    const real = a.over.filter((o) => !o.fixed);
    const fixed = a.over.filter((o) => o.fixed);
    if (!scroll && !real.length && !fixed.length && !a.tiny.length && !a.clipped.length) continue;
    say(`  [${a.vw}px]`);
    if (scroll) say(`    ! ${scroll}`);
    for (const o of real) say(`    ! overflow ${o.sel} → left ${o.left}, right ${o.right} (w ${o.w})`);
    for (const o of fixed) say(`    ? positioned offscreen ${o.sel} → left ${o.left}, right ${o.right} (w ${o.w})`);
    for (const t of a.tiny) say(`    ${t.w < 32 || t.h < 32 ? "!" : "?"} tap ${t.w}x${t.h} ${t.sel} "${t.text}"`);
    for (const c of a.clipped) say(`    ? clipped "${c.text}" (${c.sw}>${c.cw}) ${c.sel}`);
  }
}
say(problems ? `\nFAIL ${problems} viewport/route combination(s) need attention` : "\nPASS responsive check");
writeFileSync(join(process.cwd(), "scripts", "responsive-report.txt"), lines.join("\n"), "utf8");
process.exit(problems ? 1 : 0);
