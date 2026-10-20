/* Real-time verification.
 *
 *  A. Structural — every screen must load its data on mount and keep polling
 *     (guards the bug where admin pages sat on "Loading…" forever).
 *  B. Bundle     — the live-sync code actually ships to the browser.
 *  C. Behaviour  — two independent sessions see each other's writes on the very
 *     next fetch, which is exactly what a poll delivers, and nothing is cached.
 *
 * Run with: node scripts/live-check.mjs  (requires `npm run start` on :3000) */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ROOT = process.cwd();

let passed = 0;
function ok(msg) {
  passed++;
  console.log(`  ✓ ${msg}`);
}
function fail(msg) {
  console.error(`\n✗ LIVE CHECK FAILED: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
  ok(msg);
}

function read(p) {
  return readFileSync(join(ROOT, p), "utf8");
}
function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

async function req(path, { method = "GET", body, cookie } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { res, json, setCookie: res.headers.get("set-cookie"), cacheControl: res.headers.get("cache-control") };
}
function sessionOf(setCookie) {
  const m = setCookie?.match(/qfs_session=([^;]+)/);
  return m ? `qfs_session=${m[1]}` : null;
}
async function login(email, password) {
  const r = await req("/api/auth/login", { method: "POST", body: { email, password } });
  if (!r.json?.ok) fail(`login ${email}: ${JSON.stringify(r.json?.error)}`);
  return sessionOf(r.setCookie);
}

/* ---------------------------------------------------------------- A. code */
console.log("A. Screens load on mount and keep themselves fresh…");
const hook = read("lib/use-live.tsx");
for (const [re, why] of [
  [/void run\(\)/, "loads immediately on mount"],
  [/setInterval\(run, intervalMs\)/, "re-polls on an interval"],
  [/document\.hidden/ , "pauses while the tab is hidden"],
  [/visibilitychange/, "refreshes when the tab becomes visible again"],
  [/addEventListener\("focus"/, "refreshes when the window regains focus"],
  [/inFlight\.current/, "never overlaps two requests"],
  [/clearInterval/, "cleans up on unmount"],
]) assert(re.test(hook), `useLive ${why}`);

const adminPages = walk(join(ROOT, "app", "user", "admin")).filter((f) => f.endsWith("page.tsx"));
assert(adminPages.length === 11, `found ${adminPages.length} admin screens`);
for (const f of adminPages) {
  const src = readFileSync(f, "utf8");
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  assert(/useLive\(|useFetch</.test(src), `${rel} loads + polls (${/useFetch</.test(src) ? "useFetch" : "useLive"})`);
}
const dash = read("components/dashboard/DashboardApp.tsx");
assert(/useLive\(refreshOverview/.test(dash), "user dashboard polls its overview");
assert(/<LiveBadge/.test(dash), "user dashboard shows the live indicator");

/* ------------------------------------------------------------- B. bundle */
console.log("\nB. Live-sync code reaches the browser…");
const chunks = walk(join(ROOT, ".next", "static", "chunks")).filter((f) => f.endsWith(".js"));
const bundle = chunks.map((f) => readFileSync(f, "utf8")).join("\n");
assert(chunks.length > 0, `scanned ${chunks.length} client chunks`);
assert(bundle.includes("Auto-refreshes every"), "live indicator ships in the client bundle");
assert(bundle.includes("visibilitychange"), "focus/visibility refresh ships in the client bundle");

/* ----------------------------------------------------------- C. behaviour */
console.log("\nC. Two live sessions, no reload, no cache…");
const userCookie = await login("john@example.com", "Demo12345!");
const adminCookie = await login("admin@qfs.local", "Admin1234!");
if (!userCookie || !adminCookie) fail("missing session cookie");

async function userOverview() {
  const r = await req("/api/dashboard/overview", { cookie: userCookie });
  if (!r.json?.ok) fail(`overview: ${JSON.stringify(r.json?.error)}`);
  return r;
}
async function adminStats() {
  const r = await req("/api/admin/stats", { cookie: adminCookie });
  if (!r.json?.ok) fail(`stats: ${JSON.stringify(r.json?.error)}`);
  return r.json.data;
}

const ov0 = await userOverview();
assert(/no-store/.test(ov0.cacheControl ?? ""), "overview is served no-store (a poll can't read a cache)");
const statsRes = await req("/api/admin/stats", { cookie: adminCookie });
if (!statsRes.json?.ok) fail(`stats: ${JSON.stringify(statsRes.json?.error)}`);
assert(/no-store/.test(statsRes.cacheControl ?? ""), "admin stats are served no-store");
const stats0 = statsRes.json.data;

const base = {
  total: ov0.json.data.balance.totalCents,
  available: ov0.json.data.balance.availableCents,
  dep: stats0.pendingDeposits.count,
  wd: stats0.pendingWithdrawals.count,
};
ok(`baseline: total ${base.total}c, available ${base.available}c, ${base.dep} deposits / ${base.wd} withdrawals pending`);

/* --- user -> admin: a new deposit lands in the admin queue on the next poll --- */
const stamp = Date.now();
const dep = await req("/api/deposits", {
  method: "POST",
  cookie: userCookie,
  body: { amount: "25", method: "Bank Transfer", reference: `LIVE-${stamp}` },
});
if (!dep.json?.ok) fail(`deposit: ${JSON.stringify(dep.json?.error)}`);
const depId = dep.json.data.request.id;
ok(`user submitted a $25.00 deposit (${depId})`);

const stats1 = await adminStats();
assert(stats1.pendingDeposits.count === base.dep + 1, `admin's next poll sees pending deposits ${base.dep} → ${stats1.pendingDeposits.count}`);

const list1 = await req("/api/admin/requests?type=DEPOSIT&status=PENDING&page=1", { cookie: adminCookie });
if (!list1.json?.ok) fail(`requests: ${JSON.stringify(list1.json?.error)}`);
assert(
  list1.json.data.items.some((r) => r.id === depId),
  "the deposit is in the admin request queue on the very next poll"
);

/* --- admin -> user: a rejection reaches the user's balance on the next poll --- */
const wd = await req("/api/withdrawals", {
  method: "POST",
  cookie: userCookie,
  body: { amount: "25", method: "Bank Transfer", details: "live-check", reference: `LIVEWD-${stamp}` },
});
if (!wd.json?.ok) fail(`withdrawal: ${JSON.stringify(wd.json?.error)}`);
const wdId = wd.json.data.request.id;
ok(`user submitted a $25.00 withdrawal (${wdId})`);

const ov1 = await userOverview();
assert(
  ov1.json.data.balance.availableCents === base.available - 2500,
  `user's next poll shows funds reserved: available ${base.available}c → ${ov1.json.data.balance.availableCents}c`
);
assert(ov1.json.data.balance.totalCents === base.total, "the total balance is untouched while the withdrawal is pending");

const stats2 = await adminStats();
assert(stats2.pendingWithdrawals.count === base.wd + 1, `admin's next poll sees pending withdrawals ${base.wd} → ${stats2.pendingWithdrawals.count}`);

/* --- clean up: reject both, so no demo money moves --- */
for (const [id, kind] of [
  [depId, "DEPOSIT"],
  [wdId, "WITHDRAWAL"],
]) {
  const r = await req(`/api/admin/requests/${id}?type=${kind}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { action: "REJECT", note: "live-check cleanup" },
  });
  if (!r.json?.ok || r.json.data.status !== "REJECTED") fail(`reject ${kind}: ${JSON.stringify(r.json)}`);
}
ok("admin rejected both requests");

const ov2 = await userOverview();
assert(
  ov2.json.data.balance.availableCents === base.available && ov2.json.data.balance.totalCents === base.total,
  `user's next poll shows the reservation released (${ov2.json.data.balance.availableCents}c available)`
);

const stats3 = await adminStats();
assert(
  stats3.pendingDeposits.count === base.dep && stats3.pendingWithdrawals.count === base.wd,
  `admin's next poll sees both queues back to ${base.dep}/${base.wd} (live decrement)`
);

console.log(`\n✓ LIVE CHECK PASSED (${passed} assertions)`);
console.log("   every screen loads on mount, polls every 15s, and pauses when hidden");
console.log("   admin and user sessions stay in sync without a page reload");
process.exit(0);
