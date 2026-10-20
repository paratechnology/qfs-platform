/* Minimal Chrome DevTools Protocol client — headless Chrome launcher + a tiny
   CDP wrapper, so scripts can measure/screenshot the real rendered site.
   Uses Node's built-in WebSocket; no dependencies. */
import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const CHROME =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cdp {
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
        (this.events.get(msg.method) ?? []).slice().forEach((fn) => fn(msg.params, msg.sessionId));
      }
    });
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
      }, method === "Page.navigate" ? 60_000 : 30_000);
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

  /** Subscribe to an event for the lifetime of the connection. */
  on(method, fn) {
    const list = this.events.get(method) ?? [];
    list.push(fn);
    this.events.set(method, list);
    return () => this.events.set(method, (this.events.get(method) ?? []).filter((f) => f !== fn));
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Cdp(ws)), { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
  }
}

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

/** Launch headless Chrome and return { cdp, sessionId, close }. */
export async function launch({ port = 9222 } = {}) {
  const profile = join(
    process.env.TEMP ?? "C:\\Users\\USER\\AppData\\Local\\Temp",
    "opencode",
    `qfs-chrome-${Date.now()}`
  );
  mkdirSync(profile, { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);

  const close = async () => {
    try {
      cdp.ws.close();
    } catch {}
    try {
      chrome.kill();
    } catch {}
    await sleep(1000);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      /* Chrome may still be flushing its profile */
    }
  };
  return { cdp, sessionId, close, sleep };
}

export async function loginCookie(base, email, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`login ${email} failed: ${JSON.stringify(json.error)}`);
  return res.headers.get("set-cookie").match(/qfs_session=([^;]+)/)[1];
}

export { sleep };
