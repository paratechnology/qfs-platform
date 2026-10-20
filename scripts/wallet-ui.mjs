/* Drives the real Connect Wallet page in a browser with a stub EIP-1193 provider.
   The stub hands the page's challenge to this script, which signs it with a real
   throwaway key using viem, so the page runs its true code path and the server
   performs a real signature verification.

   URL flags control the stub:
     ?nostub=1   behave as a browser with no wallet installed
     ?reject=1   the next personal_sign is rejected, as if the user cancelled

   Usage: node scripts/wallet-ui.mjs [baseUrl] [width]                      */

import { launch, sleep } from "./lib/cdp.mjs";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000";
const WIDTH = Number(process.argv[3] ?? 390);

const acct = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
const ADDRESS = getAddress(acct.address);

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? " -> " + extra : ""}`);
  }
};

/* Runs before any page script, so the component's mount effect sees whatever the
   URL asks for. personal_sign parks the challenge for this script to sign with a
   real key, which is what makes the server-side verification genuine. */
const STUB = `(() => {
  const q = new URLSearchParams(location.search);
  if (q.has("nostub")) { delete window.ethereum; return; }
  const addr = ${JSON.stringify(ADDRESS)};
  window.__signRequest = null;
  window.__signResult = null;
  window.ethereum = {
    isMetaMask: true,
    async request({ method, params }) {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_accounts") return [addr];
      if (method === "eth_requestAccounts") return [addr];
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "wallet_addEthereumChain") return null;
      if (method === "personal_sign") {
        if (q.has("reject")) {
          throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        }
        window.__signRequest = new TextDecoder().decode(Uint8Array.from(
          params[0].slice(2).match(/.{2}/g), (byte) => parseInt(byte, 16)
        ));
        for (let i = 0; i < 500; i++) {
          if (window.__signResult) {
            const s = window.__signResult;
            window.__signResult = null;
            return s;
          }
          await new Promise((r) => setTimeout(r, 40));
        }
        throw Object.assign(new Error("stub timed out"), { code: -32000 });
      }
      throw new Error("unsupported method: " + method);
    },
    on() {},
    removeListener() {},
  };
})();`;

const { cdp, sessionId, close } = await launch();

const evaluate = async (expression, awaitPromise = false) => {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise },
    sessionId
  );
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? JSON.stringify(exceptionDetails));
  }
  return result.value;
};

const go = async (path) => {
  const loaded = cdp.once("Page.loadEventFired", sessionId);
  await cdp.send("Page.navigate", { url: BASE + path }, sessionId);
  await loaded;
  await sleep(700);
};

const until = async (expr, tries = 80) => {
  for (let i = 0; i < tries; i++) {
    const v = await evaluate(expr);
    if (v) return v;
    await sleep(150);
  }
  return await evaluate(expr);
};

const walletCount = () =>
  evaluate(
    `fetch("/api/wallet",{credentials:"include"}).then(r=>r.json()).then(j=>j.data.wallets.length)`,
    true
  );

try {
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: WIDTH, height: 844, deviceScaleFactor: 1, mobile: WIDTH < 900 },
    sessionId
  );
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: STUB }, sessionId);

  await go("/user/user/login");
  await cdp.send("Network.clearBrowserCookies", {}, sessionId);
  const status = await evaluate(
    `fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify(${JSON.stringify(
      { email: "john@example.com", password: "Demo12345!" }
    )})}).then(r=>r.status)`,
    true
  );
  if (status !== 200) throw new Error(`login failed: ${status}`);

  console.log(`\nWallet UI at ${WIDTH}px against ${BASE}\n`);

  console.log("no wallet installed");
  await go("/user/user/connect?nostub=1");
  const note = await evaluate(`document.querySelector(".wc-note")?.textContent ?? ""`);
  check("warns that no wallet was detected", note.includes("No Ethereum wallet"), note.slice(0, 60));
  check(
    "connect button is disabled",
    await evaluate(`document.querySelector(".wc-btn-primary")?.disabled === true`)
  );
  check(
    "offers a MetaMask link",
    (await evaluate(`document.querySelector(".wc-note a")?.href ?? ""`)).includes("metamask.io")
  );
  check("shows an empty wallet list", await evaluate(`!!document.querySelector(".wc-empty")`));

  console.log("\nconnect flow");
  await go("/user/user/connect");
  check(
    "install warning clears once a provider exists",
    !(await evaluate(`document.querySelector(".wc-note")?.textContent ?? ""`)).includes("No Ethereum wallet")
  );
  check(
    "connect button is enabled",
    await evaluate(`document.querySelector(".wc-btn-primary")?.disabled === false`)
  );

  await evaluate(`document.querySelector(".wc-btn-primary").click(); true`);
  const message = await until(`window.__signRequest`);
  check("page asked the wallet to sign a challenge", !!message);
  if (message) {
    check(
      "the challenge is the app's own message",
      message.includes("wants you to connect your wallet") &&
        message.includes(ADDRESS) &&
        message.includes("does not trigger a blockchain transaction"),
      String(message).split("\n")[0]
    );
    check(
      "the challenge states the gas cost is zero",
      /cost any gas/.test(message)
    );
    await evaluate(`window.__signResult = ${JSON.stringify(await acct.signMessage({ message }))}; true`);
  }

  const okText = await until(`document.querySelector(".wc-status-ok")?.textContent ?? ""`);
  check("reports a verified connection", /connected/i.test(String(okText)), String(okText) || "none");
  check("lists the address", await evaluate(`!!document.querySelector(".wc-addr")`));
  const shown = await evaluate(`document.querySelector(".wc-addr")?.textContent ?? ""`);
  check("shows a truncated address", shown.includes("…") && shown.length < 20, shown);
  check(
    "exposes the full address for checking",
    (await evaluate(`document.querySelector(".wc-addr")?.getAttribute("title") ?? ""`)) === ADDRESS
  );
  check(
    "links to a block explorer",
    (await evaluate(`document.querySelector(".wc-addr")?.href ?? ""`)).includes(
      "etherscan.io/address/"
    )
  );
  check(
    "marks it active in this browser",
    (await evaluate(`document.querySelector(".wc-meta")?.textContent ?? ""`)).includes("active")
  );
  check("server persisted the wallet", (await walletCount()) === 1);
  check("footer states withdrawals are still reviewed", (await evaluate(
    `document.querySelector(".wc-foot")?.textContent ?? ""`
  )).includes("administrator"));

  console.log("\nlayout at " + WIDTH + "px");
  const overflow = await evaluate(`document.body.scrollWidth`);
  check("no horizontal overflow", overflow <= WIDTH, `scrollWidth ${overflow} vs ${WIDTH}`);
  const small = await evaluate(
    `JSON.stringify([...document.querySelectorAll(".wc-btn, .wc-addr, .wc-note a")]` +
      `.map(el => ({ c: el.className, h: Math.round(el.getBoundingClientRect().height) }))` +
      `.filter(x => x.h > 0 && x.h < 32))`
  );
  check("every tap target is at least 32px tall", small === "[]", small);

  console.log("\nuser cancels the signature");
  await go("/user/user/connect?reject=1");
  await evaluate(`document.querySelector(".wc-btn-primary").click(); true`);
  const errText = await until(`document.querySelector(".wc-status-error")?.textContent ?? ""`);
  check(
    "explains the rejection instead of hanging",
    /reject/i.test(String(errText)),
    String(errText) || "no error shown"
  );
  check("a cancelled signature changes nothing", (await walletCount()) === 1);

  console.log("\ndisconnect");
  await go("/user/user/connect");
  check("existing wallet is listed", await evaluate(`!!document.querySelector(".wc-item")`));
  await evaluate(`document.querySelector(".wc-item .wc-btn").click(); true`);
  await until(`!!document.querySelector(".wc-empty")`);
  check("disconnect empties the list", await evaluate(`!!document.querySelector(".wc-empty")`));
  check("server removed the wallet", (await walletCount()) === 0);

  /* ---------------------------------------------------------------- */
  /* The dashboard modals are where the wallet is actually spent: the  */
  /* picker there decides where a payout goes.                          */
  /* ---------------------------------------------------------------- */

  console.log("\ndashboard withdrawal modal");
  await go("/user/user/connect");
  check("no wallet connected yet", (await walletCount()) === 0);

  await go("/user/user/dashboard");
  // The dashboard sidebar/quick action that opens the withdrawal modal.
  const opened = await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button, .dash-quick, a")]
      .find(el => /withdraw/i.test(el.textContent || ""));
    if (!btn) return "no withdraw control";
    btn.click();
    return "clicked";
  })()`);
  check("withdrawal control exists", opened === "clicked", String(opened));
  await until(`!!document.querySelector(".dash-modal")`);

  const pickerBefore = await evaluate(`!!document.querySelector(".dash-wallet-pick")`);
  check("no picker for Bank Transfer", pickerBefore === false);

  const switched = await evaluate(`(() => {
    const sel = document.querySelector(".dash-modal select");
    if (!sel) return "no select";
    const opt = [...sel.options].find(o => o.value === "Ethereum" || o.textContent === "Ethereum");
    if (!opt) return "no Ethereum option: " + [...sel.options].map(o=>o.value).join(",");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  })()`);
  check("can switch to Ethereum", switched === "ok", String(switched));
  await sleep(400);

  check("picker appears for a crypto method", await evaluate(`!!document.querySelector(".dash-wallet-pick")`));
  check(
    "picker points at the connect page when empty",
    (await evaluate(`document.querySelector(".dash-wallet-link")?.href ?? ""`)).includes("/user/user/connect")
  );

  // Now connect a wallet and confirm the picker fills in.
  await go("/user/user/connect");
  await evaluate(`document.querySelector(".wc-btn-primary").click(); true`);
  const dm = await until(`window.__signRequest`);
  await evaluate(`window.__signResult = ${JSON.stringify(await acct.signMessage({ message: dm }))}; true`);
  await until(`!!document.querySelector(".wc-item")`);
  check("connected for the dashboard test", (await walletCount()) === 1);

  await go("/user/user/dashboard");
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button, .dash-quick, a")]
      .find(el => /withdraw/i.test(el.textContent || ""));
    btn && btn.click();
    return true;
  })()`);
  await until(`!!document.querySelector(".dash-modal")`);
  await evaluate(`(() => {
    const sel = document.querySelector(".dash-modal select");
    const opt = [...sel.options].find(o => o.value === "Ethereum" || o.textContent === "Ethereum");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(400);

  check("chip is shown for the connected wallet", await evaluate(`!!document.querySelector(".dash-wallet-chip")`));
  await evaluate(`document.querySelector(".dash-wallet-chip").click(); true`);
  await sleep(300);
  check(
    "picking the chip fills the payout address",
    (await evaluate(`document.querySelector("#wd-details")?.value ?? ""`)) === ADDRESS,
    await evaluate(`document.querySelector("#wd-details")?.value ?? "no field"`)
  );
  check(
    "a reversibility warning is shown",
    (await evaluate(`document.querySelector(".dash-input-note")?.textContent ?? ""`)).match(
      /cannot be reversed/i
    ) !== null
  );
  const dashOverflow = await evaluate(`document.body.scrollWidth`);
  check("dashboard has no horizontal overflow", dashOverflow <= WIDTH, `scrollWidth ${dashOverflow}`);

  await go("/user/user/connect");
  await evaluate(`document.querySelector(".wc-item .wc-btn").click(); true`);
  await until(`!!document.querySelector(".wc-empty")`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
} finally {
  await close();
}

process.exit(fail === 0 ? 0 : 1);
