/* End-to-end wallet verification against the local Next -> Laravel stack.
   Creates one unfunded throwaway account. Never run against production. */
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";

const base = process.argv[2] ?? "http://localhost:3000";
const url = new URL(base);
if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
  throw new Error("This smoke test runs only against a local frontend.");
}
const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
let cookie = "";

async function api(path, method = "GET", body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: response.status, json: await response.json() };
}

const email = `wallet-${randomUUID()}@example.test`;
const registered = await api("/api/auth/register", "POST", {
  firstName: "Wallet", lastName: "Smoke", email,
  password: "SmokeTest123!", confirmPassword: "SmokeTest123!",
  phone: "+15550001234", country: "United States",
});
assert.equal(registered.status, 200, JSON.stringify(registered.json));
assert.equal(registered.json.data.registered, true);
const login = await api("/api/auth/login", "POST", { email, password: "SmokeTest123!" });
assert.equal(login.status, 200, JSON.stringify(login.json));
assert.ok(cookie);

const challenge = await api("/api/wallet/challenge", "POST", { address: account.address });
assert.equal(challenge.status, 200, JSON.stringify(challenge.json));
const { nonce, message } = challenge.json.data;
const signature = await account.signMessage({ message });
const proof = { address: account.address, nonce, signature, chainId: 1 };
const connected = await api("/api/wallet/verify", "POST", proof);
assert.equal(connected.status, 200, JSON.stringify(connected.json));
assert.equal(connected.json.data.address, account.address);

const replay = await api("/api/wallet/verify", "POST", proof);
assert.equal(replay.status, 400);
const listed = await api("/api/wallet");
assert.equal(listed.status, 200, JSON.stringify(listed.json));
assert.equal(listed.json.data.wallets.length, 1);

const disconnected = await api("/api/wallet", "POST", { address: account.address });
assert.equal(disconnected.status, 200, JSON.stringify(disconnected.json));
const empty = await api("/api/wallet");
assert.equal(empty.json.data.wallets.length, 0);
console.log("Wallet registration, challenge, signature, replay protection, listing, and disconnect passed.");
