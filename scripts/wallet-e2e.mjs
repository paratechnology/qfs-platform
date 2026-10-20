/* Live end-to-end check of the wallet flow against the running dev server.
   Signs with a throwaway key using viem, so this exercises the real
   verifyMessage path, not a mock.

   Usage: node scripts/wallet-e2e.mjs [baseUrl]                          */

import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";

const BASE = process.argv[2] ?? "http://localhost:3000";
const EMAIL = "john@example.com";
const PASSWORD = "Demo12345!";

/* Throwaway test key. Never holds real funds. */
const acct = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
const MALLORY = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca3a545d3b0e0f8b3a1f0a0d2c5e6f708192a3b4c5d6e7"
);

let cookie = "";
let pass = 0;
let fail = 0;

function check(name, ok, extra = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? " -> " + extra : ""}`);
  }
}

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

console.log(`\nWallet E2E against ${BASE}\n`);

console.log("auth");
const login = await api("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
check("login succeeds", login.status === 200 && login.body?.ok === true, JSON.stringify(login.body));
if (!cookie) {
  console.log("\nNo session cookie. Aborting.");
  process.exit(1);
}

console.log("\nchallenge");
const me = await api("/api/auth/me");
check("session is authenticated", me.status === 200 && me.body?.ok === true);

const badAddr = await api("/api/wallet/challenge", {
  method: "POST",
  body: JSON.stringify({ address: "not-an-address" }),
});
check("rejects a malformed address", badAddr.status === 400, `status ${badAddr.status}`);

const chal = await api("/api/wallet/challenge", {
  method: "POST",
  body: JSON.stringify({ address: getAddress(acct.address) }),
});
check("issues a challenge", chal.status === 200 && !!chal.body?.data?.nonce);
if (!chal.body?.data?.nonce) {
  console.log("\nNo challenge issued. Aborting.");
  process.exit(1);
}
const { nonce, message } = chal.body.data;
check(
  "message names the app and states it costs no gas",
  message.includes("wants you to connect your wallet") &&
    message.includes("does not trigger a blockchain transaction"),
  message.split("\n")[0]
);

console.log("\nspoofing");
const wrongKey = await api("/api/wallet/verify", {
  method: "POST",
  body: JSON.stringify({
    address: getAddress(acct.address),
    signature: await MALLORY.signMessage({ message }),
    nonce,
    chainId: 1,
  }),
});
check("rejects a signature from another key", wrongKey.status === 400, JSON.stringify(wrongKey.body));

const wrongChain = await api("/api/wallet/verify", {
  method: "POST",
  body: JSON.stringify({
    address: getAddress(acct.address),
    signature: await MALLORY.signMessage({ message }),
    nonce,
    chainId: 137,
  }),
});
check("rejects a non-mainnet chain", wrongChain.status === 400, `status ${wrongChain.status}`);

const nonceOfOther = await api("/api/wallet/challenge", {
  method: "POST",
  body: JSON.stringify({ address: getAddress(acct.address) }),
});
const foreignNonce = nonceOfOther.body.data.nonce;
const foreignMessage = nonceOfOther.body.data.message;
const foreignSig = await acct.signMessage({ message: foreignMessage });
const swapped = await api("/api/wallet/verify", {
  method: "POST",
  body: JSON.stringify({
    address: getAddress(acct.address),
    signature: foreignSig,
    nonce: "deadbeefdeadbeefdeadbeefdeadbeef",
    chainId: 1,
  }),
});
check("rejects an unknown nonce", swapped.status === 400, `status ${swapped.status}`);

console.log("\nverify");
const good = await api("/api/wallet/verify", {
  method: "POST",
  body: JSON.stringify({
    address: getAddress(acct.address),
    signature: await acct.signMessage({ message: foreignMessage }),
    nonce: foreignNonce,
    chainId: 1,
    label: "E2E test",
  }),
});
check(
  "accepts a genuine signature",
  good.status === 200 && good.body?.ok === true,
  JSON.stringify(good.body)
);

const replay = await api("/api/wallet/verify", {
  method: "POST",
  body: JSON.stringify({
    address: getAddress(acct.address),
    signature: foreignSig,
    nonce: foreignNonce,
    chainId: 1,
  }),
});
check("rejects a replayed signature", replay.status === 400, `status ${replay.status}`);

console.log("\nlist + disconnect");
const list = await api("/api/wallet");
const wallets = list.body?.data?.wallets ?? [];
check("lists the connected wallet", wallets.some((w) => w.address === getAddress(acct.address)));

const anon = await fetch(BASE + "/api/wallet");
check("wallet list requires a session", anon.status === 401, `status ${anon.status}`);

const del = await api("/api/wallet", {
  method: "POST",
  body: JSON.stringify({ address: getAddress(acct.address) }),
});
check("disconnects", del.status === 200 && del.body?.ok === true, JSON.stringify(del.body));

const after = await api("/api/wallet");
check("list is empty after disconnect", (after.body?.data?.wallets ?? []).length === 0);

/* ------------------------------------------------------------------ */
/* Money movement: the reason the wallet exists. Re-connect, then make  */
/* a withdrawal and a deposit that name the verified address, and       */
/* confirm the admin side is told where the money goes.                 */
/* ------------------------------------------------------------------ */

console.log("\nreconnect for the money flow");
const rc = await api("/api/wallet/challenge", {
  method: "POST",
  body: JSON.stringify({ address: getAddress(acct.address) }),
});
await api("/api/wallet/verify", {
  method: "POST",
  body: JSON.stringify({
    address: getAddress(acct.address),
    signature: await acct.signMessage({ message: rc.body.data.message }),
    nonce: rc.body.data.nonce,
    chainId: 1,
  }),
});
check("reconnected", (await api("/api/wallet")).body.data.wallets.length === 1);

const WALLET = getAddress(acct.address);

console.log("\nwithdrawal");
const badAddrWd = await api("/api/withdrawals", {
  method: "POST",
  body: JSON.stringify({ amount: 10, method: "Ethereum", details: "nope", walletAddress: "0x123" }),
});
check(
  "rejects a malformed wallet address on a withdrawal",
  badAddrWd.status === 400,
  `status ${badAddrWd.status}`
);

const wd = await api("/api/withdrawals", {
  method: "POST",
  body: JSON.stringify({
    amount: 10,
    method: "Ethereum",
    details: WALLET,
    walletAddress: WALLET,
  }),
});
check("creates a withdrawal", wd.status === 200 && wd.body?.ok === true, JSON.stringify(wd.body));
const wdId = wd.body?.data?.request?.id;

const adminCookieHolder = cookie;
cookie = adminCookieHolder;
const adminLogin = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email: "admin@qfs.local", password: "Admin1234!" }),
});
cookie = (adminLogin.headers.get("set-cookie") ?? "").split(";")[0];
check("admin can sign in", !!cookie);

const reqs = await api("/api/admin/requests?type=WITHDRAWAL&limit=50");
const row = (reqs.body?.data?.items ?? []).find((r) => r.id === wdId);
check("admin sees the request", !!row);
check(
  "admin sees the full payout address",
  row?.walletAddress === WALLET,
  row?.walletAddress ?? "missing"
);
check("admin sees the method", row?.method === "Ethereum", row?.method);

console.log("\ndeposit");
const dep = await api("/api/deposits", {
  method: "POST",
  body: JSON.stringify({ amount: 100, method: "Ethereum", walletAddress: WALLET }),
});
check("creates a deposit", dep.status === 200 && dep.body?.ok === true, JSON.stringify(dep.body));
const depId = dep.body?.data?.request?.id;

const depReqs = await api("/api/admin/requests?type=DEPOSIT&limit=50");
const depRow = (depReqs.body?.data?.items ?? []).find((r) => r.id === depId);
check("admin sees the source wallet on the deposit", depRow?.walletAddress === WALLET, depRow?.walletAddress);

console.log("\nadmin approval still gates the money");
check("withdrawal starts pending", row?.status === "PENDING", row?.status);

const approve = await api(`/api/admin/requests/${wdId}?type=WITHDRAWAL`, {
  method: "PATCH",
  body: JSON.stringify({ action: "APPROVE", note: "e2e" }),
});
check("admin can approve", approve.status === 200 && approve.body?.ok === true, JSON.stringify(approve.body));

/* Reject the deposit so the demo balance is left as it was found. */
const rejectDep = await api(`/api/admin/requests/${depId}?type=DEPOSIT`, {
  method: "PATCH",
  body: JSON.stringify({ action: "REJECT", note: "e2e cleanup" }),
});
check("admin can reject", rejectDep.status === 200 && rejectDep.body?.ok === true, JSON.stringify(rejectDep.body));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
