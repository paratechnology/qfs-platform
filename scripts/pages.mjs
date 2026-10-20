/* Render sanity check: admin pages return 200 for an admin session, and the
   role guard redirects a plain user. Run: node scripts/pages.mjs */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  const m = setCookie?.match(/qfs_session=([^;]+)/);
  return m ? `qfs_session=${m[1]}` : null;
}

async function get(path, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual",
  });
  const body = await res.text();
  return { status: res.status, location: res.headers.get("location"), body };
}

const admin = await post("/api/auth/login", { email: "admin@qfs.local", password: "Admin1234!" });
const user = await post("/api/auth/login", { email: "john@example.com", password: "Demo12345!" });
if (!admin || !user) { console.error("login failed"); process.exit(1); }

const adminPages = [
  "/user/admin", "/user/admin/users", "/user/admin/requests", "/user/admin/transactions",
  "/user/admin/plans", "/user/admin/loans", "/user/admin/documents", "/user/admin/reviews",
  "/user/admin/markets", "/user/admin/settings", "/user/admin/audit",
];
let bad = 0;
for (const p of adminPages) {
  const r = await get(p, admin);
  const ok = r.status === 200 && !/Application error/i.test(r.body);
  if (!ok) { bad++; console.error(`✗ ${p} → ${r.status}`); }
}
const guard = await get("/user/admin", user); // plain USER must be redirected
if (!(guard.status === 307 || (guard.status === 200 && /\/user\/user\/dashboard/.test(guard.body)))) {
  bad++; console.error(`✗ role guard: user got ${guard.status} loc=${guard.location}`);
}
const anon = await get("/user/admin", null);
if (!(anon.status === 307 || (anon.status === 200 && /\/user\/user\/login/.test(anon.body)))) {
  bad++; console.error(`✗ anon guard: got ${anon.status} loc=${anon.location}`);
}
const dash = await get("/user/user/dashboard", user);
if (!(dash.status === 200 && !/Application error/i.test(dash.body))) {
  bad++; console.error(`✗ user dashboard → ${dash.status}`);
}

console.log(bad === 0 ? `\n✓ PAGES OK: ${adminPages.length} admin pages 200, guards redirect correctly` : `\n✗ ${bad} page failures`);
process.exit(bad === 0 ? 0 : 1);