/* One-off layout probe: loads a route at a viewport and evaluates an expression
 * in the page, printing the result. For digging into a specific layout question.
 *
 *   node scripts/probe.mjs "/user/user/register" 430 "<js expression>"
 *
 * With no expression it reports the widest min-content offenders. */
import { launch, sleep } from "./lib/cdp.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const route = process.argv[2] ?? "/";
const width = Number(process.argv[3] ?? 390);
const height = Number(process.argv[4] ?? 844);
const expr = process.argv[5];

const { cdp, sessionId, close } = await launch();
const ANON = process.env.ANON === "1";

try {
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: 1, mobile: width < 900 },
    sessionId
  );
  const first = cdp.once("Page.loadEventFired", sessionId);
  await cdp.send("Page.navigate", { url: BASE + "/user/user/login" }, sessionId);
  await first;
  await cdp.send("Network.clearBrowserCookies", {}, sessionId);
  if (!ANON) {
    // Log in from inside the page so the browser stores the session cookie itself.
    await cdp.send(
      "Runtime.evaluate",
      {
        expression: `fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify(${JSON.stringify(
          { email: "admin@qfs.local", password: "Admin1234!" }
        )})}).then(r=>r.status)`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId
    );
  }
  const loaded = cdp.once("Page.loadEventFired", sessionId);
  await cdp.send("Page.navigate", { url: BASE + route }, sessionId);
  await loaded;
  await sleep(600);

  const arg = process.argv[5];
  const custom = arg?.startsWith("@") ? readFileSync(arg.slice(1), "utf8") : arg;
  const script = custom ?? `(() => {
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      const prev = el.style.width;
      el.style.width = "min-content";
      const w = Math.round(el.getBoundingClientRect().width);
      el.style.width = prev;
      const r = el.getBoundingClientRect();
      if (w > window.innerWidth + 1 || r.right > window.innerWidth + 1) {
        const s = getComputedStyle(el);
        out.push({
          sel: el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).slice(0,2).join(".") : ""),
          minContent: w,
          width: Math.round(r.width),
          right: Math.round(r.right),
          display: s.display,
          minWidth: s.minWidth,
          whiteSpace: s.whiteSpace,
          text: (el.textContent || "").trim().slice(0, 32)
        });
      }
    }
    return JSON.stringify(out.slice(0, 30), null, 1);
  })()`;

  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression: script, returnByValue: true, awaitPromise: true },
    sessionId
  );
  if (exceptionDetails) console.log("EXCEPTION:", JSON.stringify(exceptionDetails.exception?.description ?? exceptionDetails));
  console.log(typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 1));
} finally {
  await close();
}
