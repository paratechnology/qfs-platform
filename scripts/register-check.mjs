/* Register-page contract check: form fields, storage of name/country/phone, validation.
   Run: node scripts/register-check.mjs (with `npm run start` on :3000) */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let bad = 0;
const ok = (cond, msg) => { if (!cond) { bad++; console.error(`✗ ${msg}`); } else console.log(`✓ ${msg}`); };

/* 1. The rendered page must expose the new field names. */
const page = await (await fetch(`${BASE}/user/user/register`)).text();
for (const f of ["firstName", "lastName", "email", "country", "phone", "password", "confirmPassword"]) {
  ok(new RegExp(`name="${f}"`).test(page), `form field "${f}" present`);
}
ok(/Full Name/i.test(page) === false, "old single 'Full Name' field is gone");
ok(/<select[^>]*name="country"/.test(page), "country is a dropdown select");

/* 2. Successful registration stores first+last, country and phone. */
const stamp = Date.now();
const email = `reg${stamp}@test.qfs`;
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    firstName: "Ama",
    lastName: "Serwaa",
    email,
    password: "Strong1234!",
    confirmPassword: "Strong1234!",
    country: "Ghana",
    phone: "+233 24 555 0199",
  }),
});
const regJson = await reg.json();
ok(regJson.ok === true, `register accepted (${reg.status})`);
ok(regJson?.data?.registered === true, "registration is complete without automatic login");
ok(!reg.headers.get("set-cookie")?.match(/qfs_session=([^;]+)/), "registration does not issue a signed-in session");
ok(regJson?.data?.user?.name === "Ama Serwaa", `name = "Ama Serwaa" (got ${regJson?.data?.user?.name})`);

/* 3. Admin sees the phone. */
const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@qfs.local", password: "Admin1234!" }),
});
const cookie = login.headers.get("set-cookie")?.match(/qfs_session=([^;]+)/)?.[1];
const list = await (await fetch(`${BASE}/api/admin/users?search=${encodeURIComponent(email)}`, {
  headers: { Cookie: `qfs_session=${cookie}` },
})).json();
const row = list?.data?.items?.[0];
ok(row?.name === "Ama Serwaa", "admin user row shows full name");
ok(row?.phone === "+233 24 555 0199", `admin user row shows phone (got ${row?.phone})`);
ok(row?.country === "Ghana", "admin user row shows country");

/* 4. Validation rejects bad input. */
const badCases = [
  [{ firstName: "A", lastName: "B", email, password: "Strong1234!", confirmPassword: "Strong1234!", country: "Ghana", phone: "+233 20 000 0000" }, "first name too short"],
  [{ firstName: "Solo", email, password: "Strong1234!", confirmPassword: "Strong1234!", country: "Ghana", phone: "+233 20 000 0000" }, "last name missing"],
  [{ firstName: "Solo", lastName: "Name", email, password: "Strong1234!", confirmPassword: "Strong1234!", country: "Ghana" }, "phone missing"],
  [{ firstName: "Solo", lastName: "Name", email, password: "Strong1234!", confirmPassword: "Strong1234!", country: "Ghana", phone: "call me" }, "phone with letters"],
  [{ firstName: "Solo", lastName: "Name", email, password: "Strong1234!", confirmPassword: "Different1!", country: "Ghana", phone: "+233 20 000 0000" }, "password mismatch"],
];
for (const [body, label] of badCases) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json();
  ok(r.status === 400, `rejected: ${label} (${r.status} ${j?.error?.message ?? ""})`);
}

console.log(bad === 0 ? "\n✓ REGISTER CHECK PASSED" : `\n✗ ${bad} failures`);
process.exit(bad === 0 ? 0 : 1);
