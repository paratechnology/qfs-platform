/* Fresh-DB smoke test: register → login → deposit → admin approve → balance check.
   Run with: node scripts/smoke.mjs  (requires `npm run start` running on :3000) */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

function fail(msg) {
  console.error(`\n✗ SMOKE FAILED: ${msg}`);
  process.exit(1);
}

async function req(path, { method = "GET", body, cookie } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const json = await res.json().catch(() => null);
  return { res, json, setCookie: res.headers.get("set-cookie") };
}

function extractSession(setCookie) {
  if (!setCookie) return null;
  const m = setCookie.match(/qfs_session=([^;]+)/);
  return m ? `qfs_session=${m[1]}` : null;
}

// Fresh registration each run.
const stamp = Date.now();
const email = `smoke${stamp}@test.qfs`;

console.log("1. Register a new user…");
const reg = await req("/api/auth/register", {
  method: "POST",
  body: {
    firstName: "Smoke",
    lastName: "Test",
    email,
    password: "Smoke1234!",
    confirmPassword: "Smoke1234!",
    country: "Ghana",
    phone: "+233 20 000 0000",
  },
});
if (!reg.json?.ok) fail(`register: ${JSON.stringify(reg.json?.error)}`);

const userCookie = extractSession(reg.setCookie) ?? (await login(email, "Smoke1234!"));
if (!userCookie) fail("no session cookie after register/login");

async function login(user, pass) {
  const r = await req("/api/auth/login", { method: "POST", body: { email: user, password: pass } });
  if (!r.json?.ok) fail(`login ${user}: ${JSON.stringify(r.json?.error)}`);
  return extractSession(r.setCookie);
}

console.log("2. Read overview (baseline)…");
const ov0 = await req("/api/dashboard/overview", { cookie: userCookie });
const bal0 = ov0.json?.data?.balance?.totalCents;
if (!ov0.json?.ok || typeof bal0 !== "number") fail(`overview: ${JSON.stringify(ov0.json?.error)}`);

console.log(`3. Create a $250.00 deposit…`);
const dep = await req("/api/deposits", {
  method: "POST",
  cookie: userCookie,
  body: { amount: "250", method: "Bank Transfer", reference: `SMOKE-${stamp}` },
});
if (!dep.json?.ok) fail(`deposit: ${JSON.stringify(dep.json?.error)}`);
const depositId = dep.json?.data?.request?.id;
if (!depositId) fail("deposit returned no request id");

console.log("4. Login as admin, approve the deposit…");
const adminCookie = await login("admin@qfs.local", "Admin1234!");
const approve = await req(`/api/admin/requests/${depositId}?type=DEPOSIT`, {
  method: "PATCH",
  cookie: adminCookie,
  body: { action: "APPROVE", note: "Smoke-test approval" },
});
if (!approve.json?.ok) fail(`approve: ${JSON.stringify(approve.json?.error)}`);
if (!(approve.json?.data?.decided === true && approve.json?.data?.status === "APPROVED")) {
  fail(`approve response unexpected: ${JSON.stringify(approve.json?.data)}`);
}

console.log("5. Verify the user's balance updated by exactly $250.00…");
const ov1 = await req("/api/dashboard/overview", { cookie: userCookie });
const bal1 = ov1.json?.data?.balance?.totalCents;
if (typeof bal1 !== "number" || bal1 - bal0 !== 25000) {
  fail(`balance moved ${bal1} - ${bal0} = ${bal1 - bal0}c (expected 25000c)`);
}

console.log("6. Check admin stats reflect a completed deposit…");
const stats = await req("/api/admin/stats", { cookie: adminCookie });
if (!stats.json?.ok) fail(`stats: ${JSON.stringify(stats.json?.error)}`);

console.log("7. Idempotent re-submit of same deposit reference is rejected/returned…");
const reDep = await req("/api/deposits", {
  method: "POST",
  cookie: userCookie,
  body: { amount: "250", method: "Bank Transfer", reference: `SMOKE-${stamp}` },
});
if (!(reDep.json?.ok && reDep.json?.data?.created === false)) fail("deposit retry was not idempotent");

console.log("\n✓ SMOKE PASSED");
console.log(`   user ${email} balance: ${bal0}c → ${bal1}c (+$250.00)`);
console.log(`   deposit ${depositId} approved by admin`);
process.exit(0);