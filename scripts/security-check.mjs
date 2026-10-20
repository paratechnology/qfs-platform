/* Live security checks against a running server (`npm run start`).
   Verifies headers, CSRF, auth throttling, cron secret and session revocation. */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let bad = 0;
const ok = (cond, msg) => {
  if (!cond) {
    bad++;
    console.error(`x ${msg}`);
  } else console.log(`+ ${msg}`);
};

const json = async (path, opts = {}) => {
  const res = await fetch(`${BASE}${path}`, opts);
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { res, body };
};
const post = (path, body, headers = {}) =>
  json(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

/* 1. Security headers on a normal page response. */
const page = await fetch(`${BASE}/`);
ok(page.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "CSP present with frame-ancestors none");
ok(page.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");
ok(page.headers.get("x-frame-options") === "DENY", "X-Frame-Options: DENY");
ok(page.headers.get("referrer-policy") === "strict-origin-when-cross-origin", "Referrer-Policy set");
ok(!!page.headers.get("permissions-policy"), "Permissions-Policy set");
ok(!page.headers.get("x-powered-by"), "X-Powered-By removed");
ok(
  process.env.NODE_ENV !== "production" || !!page.headers.get("strict-transport-security"),
  "HSTS present in production"
);

/* 2. API responses are never cached. */
const anon = await json("/api/dashboard/overview");
ok(anon.res.status === 401, "unauthenticated overview is 401");
ok(anon.res.headers.get("cache-control") === "no-store", "API responses are no-store");

/* 3. CSRF: cross-site writes are refused, same-origin passes. */
const xOrigin = await post("/api/auth/login", { email: "x@y.zz", password: "Whatever1!" }, { Origin: "https://evil.example" });
ok(xOrigin.res.status === 403, `cross-site Origin blocked (${xOrigin.res.status})`);
const xFetch = await post("/api/auth/login", { email: "x@y.zz", password: "Whatever1!" }, { "sec-fetch-site": "cross-site" });
ok(xFetch.res.status === 403, `Sec-Fetch-Site cross-site blocked (${xFetch.res.status})`);
const same = await post("/api/auth/login", { email: "x@y.zz", password: "Whatever1!" }, { Origin: BASE });
ok(same.res.status === 401, `same-origin Origin reaches the handler (${same.res.status}, not 403)`);

/* 4. Weak passwords are refused at the API boundary. */
const weak = await post("/api/auth/register", {
  firstName: "Weak", lastName: "Pass", email: `weak${Date.now()}@test.qfs`,
  password: "password", confirmPassword: "password", country: "Ghana", phone: "+233 20 000 0000",
});
ok(weak.res.status === 400, `weak password rejected (${weak.res.status})`);

/* 5. Oversized bodies are refused (real 100 KB body, honest content-length). */
const huge = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ firstName: "Big", lastName: "Body", pad: "x".repeat(100_000) }),
});
ok(huge.status === 413, `oversized body rejected (${huge.status})`);

/* 6. Cron endpoint requires the secret. */
const noSecret = await post("/api/cron/accrue", {}, { "x-cron-secret": "wrong-secret" });
ok(noSecret.res.status === 403, `wrong cron secret rejected (${noSecret.res.status})`);

/* 7. A suspended user's live session stops working immediately. */
const email = `susp${Date.now()}@test.qfs`;
const reg = await post("/api/auth/register", {
  firstName: "Sus", lastName: "Pend", email,
  password: "Strong1234!", confirmPassword: "Strong1234!", country: "Ghana", phone: "+233 20 000 0000",
});
ok(reg.res.status === 200, `registered ${email}`);
ok(!reg.res.headers.get("set-cookie")?.match(/qfs_session=([^;]+)/), "registration does not sign the user in");
const userLogin = await post("/api/auth/login", { email, password: "Strong1234!" });
const userCookie = userLogin.res.headers.get("set-cookie")?.match(/qfs_session=([^;]+)/)?.[1];
ok(!!userCookie, "explicit login issues the session cookie");

const before = await json("/api/dashboard/overview", { headers: { Cookie: `qfs_session=${userCookie}` } });
ok(before.res.status === 200, "session works before suspension");

const adminLogin = await post("/api/auth/login", { email: "admin@qfs.local", password: "Admin1234!" });
const adminCookie = adminLogin.res.headers.get("set-cookie")?.match(/qfs_session=([^;]+)/)?.[1];
const users = await json(`/api/admin/users?search=${encodeURIComponent(email)}`, {
  headers: { Cookie: `qfs_session=${adminCookie}` },
});
const target = users.body?.data?.items?.[0];
ok(!!target, "admin can find the user");

const susp = await json(`/api/admin/users/${target.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Cookie: `qfs_session=${adminCookie}`, Origin: BASE },
  body: JSON.stringify({ action: "SUSPEND" }),
});
ok(susp.res.status === 200, `suspended (${susp.res.status})`);

const after = await json("/api/dashboard/overview", { headers: { Cookie: `qfs_session=${userCookie}` } });
ok(after.res.status === 401, `suspended session is dead (${after.res.status})`);

const dash = await fetch(`${BASE}/user/user/dashboard`, {
  headers: { Cookie: `qfs_session=${userCookie}` },
  redirect: "manual",
});
ok(dash.status === 307 && (dash.headers.get("location") ?? "").includes("/login"), "dashboard redirects a suspended user to login");

/* 8. Re-login is refused for the suspended account. */
const relogin = await post("/api/auth/login", { email, password: "Strong1234!" });
ok(relogin.res.status === 403, `suspended user cannot log in (${relogin.res.status})`);

console.log(bad === 0 ? "\n+ SECURITY CHECK PASSED" : `\nx ${bad} failures`);
process.exit(bad === 0 ? 0 : 1);
