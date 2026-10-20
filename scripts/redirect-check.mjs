/* Session-redirect matrix. Follows redirects with a hard cap so any loop
 * shows up as a failure instead of hanging.
 *   node scripts/redirect-check.mjs */
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const php = (code) => execFileSync("php", ["-r",
  `require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); if(!app()->environment('local'))throw new RuntimeException('Local checks only'); ${code}`,
], { cwd: new URL("../server/", import.meta.url), encoding: "utf8" }).trim();

const follow = async (path, cookie, cap = 6) => {
  const chain = [];
  let url = path;
  for (let i = 0; i < cap; i++) {
    const res = await fetch(BASE + url, {
      headers: cookie ? { cookie: `qfs_session=${cookie}` } : {},
      redirect: "manual",
    });
    const loc = res.headers.get("location");
    chain.push(`${res.status} ${url}`);
    if (!loc) return { chain, final: url.split("?")[0], status: res.status, loop: false, html: await res.text() };
    url = loc.startsWith("http") ? loc.replace(BASE, "") : loc;
  }
  return { chain, final: url.split("?")[0], status: null, loop: true };
};

// Temporary sessions exercise real server guards without passwords or account changes.
const { user, admin } = JSON.parse(php("$tokens=[]; foreach(['user'=>'USER','admin'=>'ADMIN'] as $label=>$role){$id=Illuminate\\Support\\Facades\\DB::table('User')->where('role',$role)->where('status','ACTIVE')->value('id');if(!$id)throw new RuntimeException('Active test roles are required');$tokens[$label]=App\\Support\\SessionAuth::issue($id);}echo json_encode($tokens);"));

try {
const cases = [
  ["no cookie  -> dashboard", "/user/user/dashboard", null, "/user/user/login"],
  ["no cookie  -> login", "/user/user/login", null, "/user/user/login"],
  ["no cookie  -> register", "/user/user/register", null, "/user/user/register"],
  ["bad cookie -> dashboard", "/user/user/dashboard", "deadbeef", "/user/user/login"],
  ["bad cookie -> login", "/user/user/login", "deadbeef", "/user/user/login"],
  ["bad cookie -> register", "/user/user/register", "deadbeef", "/user/user/register"],
  ["bad cookie -> /user/admin", "/user/admin", "deadbeef", "/admin/login"],
  ["user       -> dashboard", "/user/user/dashboard", user, "/user/user/dashboard"],
  ["user       -> login", "/user/user/login", user, "/user/user/login"],
  ["user       -> register", "/user/user/register", user, "/user/user/register"],
  ["user       -> /user/admin", "/user/admin", user, "/user/user/dashboard"],
  ["admin      -> login", "/user/user/login", admin, "/user/user/login"],
  ["admin      -> register", "/user/user/register", admin, "/user/user/register"],
  ["admin      -> /user/admin", "/user/admin", admin, "/admin"],
  ["admin      -> dashboard", "/user/user/dashboard", admin, "/user/user/dashboard"],
  ["no cookie  -> admin login", "/admin/login", null, "/admin/login"],
  ["bad cookie -> admin login", "/admin/login", "deadbeef", "/admin/login"],
  ["user       -> admin login", "/admin/login", user, "/admin/login"],
  ["admin      -> admin login", "/admin/login", admin, "/admin/login"],
  ["no cookie  -> admin", "/admin", null, "/admin/login"],
];

let fail = 0;
for (const [name, path, cookie, expect] of cases) {
  const r = await follow(path, cookie);
  const formField = { "/user/user/login": "login-email", "/user/user/register": "register-first", "/admin/login": "admin-email" }[expect];
  const ok = !r.loop && r.final === expect && r.status === 200 && (!formField || r.html?.includes(`id="${formField}"`));
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(26)} ${r.loop ? "REDIRECT LOOP" : r.status} @ ${r.final}` +
      (ok ? "" : `\n        expected 200 @ ${expect}`)
  );
  if (!ok) console.log("        " + r.chain.join("  ->  "));
}
console.log(fail ? `\n${fail} case(s) wrong` : "\nall redirect cases correct");
process.exitCode = fail ? 1 : 0;
} finally {
  for (const token of [user, admin]) {
    php(`Illuminate\\Support\\Facades\\DB::table('Session')->where('tokenHash',App\\Support\\SessionAuth::tokenHash('${token}'))->delete();`);
  }
}
