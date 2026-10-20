/* Browser checks for account navigation and request feedback.
 * Login is real; all money and loan requests are intercepted in this isolated
 * browser and answered with fixtures. No financial records are written.
 * Set QFS_CHECK_EMAIL and QFS_CHECK_PASSWORD, then run this script.
 * Use --german-only for the focused German layout and amount-entry checks. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, loginCookie, sleep } from "./lib/cdp.mjs";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const root = "/user/user/dashboard";
if (!process.env.QFS_CHECK_EMAIL || !process.env.QFS_CHECK_PASSWORD) throw new Error("Set QFS_CHECK_EMAIL and QFS_CHECK_PASSWORD");
const cookie = await loginCookie(base, process.env.QFS_CHECK_EMAIL, process.env.QFS_CHECK_PASSWORD);
const response = await fetch(`${base}/api/dashboard/overview`, { headers: { Cookie: `qfs_session=${cookie}` } });
const payload = await response.json();
assert(payload.ok, "Live overview loads");
const fixture = payload.data;
fixture.balance.availableCents = 10000000;
fixture.balance.available = "$100,000.00";
fixture.accrual.items = [];
fixture.kyc = { status: "NOT_STARTED", submittedAt: null, reviewedAt: null, reviewNote: null };
fixture.user.kycLevel = 0;

const stub = `(() => {
  const original = window.fetch.bind(window);
  const overview = ${JSON.stringify(fixture)};
  const state = window.__dashboardCheck = { posts: [], failInvestment: true, failTransactions: true, withdrawals: [], loans: [] };
  state.completed = [{id:"fixture-matured",plan:"QFS Completed Plan",payoutInterval:"MONTHLY",monthlyRate:"5.00%",principal:"$1,000.00",monthlyProfit:"$50.00",startedAt:"2026-08-01T00:00:00Z",endsAt:"2026-09-01T00:00:00Z",pending:"$0.0000",paid:"$50.00",status:"MATURED",principalRelease:"MANUAL",maturedAt:"2026-09-01T00:00:00Z",principalReturnedAt:null,termMonths:1,progressPercent:100,totalExpectedProfit:"$50.00",terms:"Original plan conditions",documents:[{id:"fixture-conditions",title:"Investment conditions",fileUrl:"/api/documents/files/fixture.pdf"}]}];
  state.principalReleased = false;
  state.plan = {id:"fixture-language-plan",name:"Language test plan",description:"Original description",terms:"Original conditions",riskDisclosure:"Capital is at risk",translations:null,documentIds:"[]",minAmountCents:10000,maxAmountCents:null,monthlyRoiBps:350,termMonths:3,payoutInterval:"MONTHLY",principalRelease:"MANUAL",sort:1,color:"#992c92",isActive:true};
  state.failRecovery = true; state.failPasswordReset = true;
  state.kyc = { ...overview.kyc, id:null, version:0, details:{}, files:[] };
  state.adminKyc = {id:"fixture-review",version:7,status:"PENDING",submittedAt:new Date().toISOString(),reviewedAt:null,reviewNote:null,details:{legalName:"Example Investor",dateOfBirth:"1992-05-10",country:"Nigeria",address:"10 Example Street",documentType:"PASSPORT"},files:[{id:"face",kind:"PORTRAIT",size:68,url:"/api/kyc/files/fixture"},{id:"id",kind:"IDENTITY_FRONT",size:68,url:"/api/kyc/files/fixture"}]};
  const reply = (data, status = 200) => new Response(JSON.stringify(status === 200 ? {ok:true,data} : {ok:false,error:{message:data}}), {status,headers:{"Content-Type":"application/json"}});
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.origin);
    if (!url.pathname.startsWith("/api/")) return original(input, options);
    if (url.pathname === "/api/wallet") { state.mounted = true; return reply({wallets:[]}); }
    await new Promise((resolve) => setTimeout(resolve, 650));
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
    if (url.pathname === "/api/admin/plans") return reply([state.plan]);
    if (url.pathname === "/api/admin/plans/fixture-language-plan" && options.method === "PATCH") {
      state.posts.push({path:url.pathname,body}); return reply({...state.plan,...body});
    }
    if (url.pathname === "/api/admin/documents") return reply([]);
    if (url.pathname === "/api/admin/investments") return reply(state.principalReleased ? [] : [{id:"fixture-matured",userName:"Example Investor",userEmail:"fixture@example.test",planName:"QFS Completed Plan",amountCents:100000,paidOutCents:5000,status:"MATURED",maturedAt:"2026-09-01T00:00:00Z",principalRelease:"MANUAL"}]);
    if (url.pathname === "/api/admin/investments/fixture-matured" && options.method === "PATCH") {
      state.posts.push({path:url.pathname,body}); state.principalReleased = true;
      return reply({released:true,investment:{status:"CLOSED",principalReturnedAt:new Date().toISOString()}});
    }
    if (url.pathname === "/api/admin/kyc") return reply([{...state.adminKyc,userName:"Example Investor",email:"fixture@example.test"}]);
    if (url.pathname === "/api/admin/kyc/fixture-review") {
      if(options.method === "PATCH") { state.adminKyc.status=body.action === "APPROVE" ? "APPROVED" : "NEEDS_CHANGES"; state.adminKyc.version++; }
      return reply(state.adminKyc);
    }
    if (options.method === "POST") {
      state.posts.push({path:url.pathname,body});
      if (url.pathname === "/api/auth/forgot-password") {
        if (state.failRecovery) { state.failRecovery=false; return reply("Email recovery is temporarily unavailable. Please contact support.",503); }
        return reply({message:"If an active account matches this email, look for a password reset link."});
      }
      if (url.pathname === "/api/auth/reset-password") {
        if (state.failPasswordReset) { state.failPasswordReset=false; return reply("Temporary service failure. Please try again.",503); }
        return reply({message:"Your password has been changed."});
      }
      if (url.pathname === "/api/kyc") {
        state.kyc = { ...state.kyc, details:body, id:"fixture-kyc", version:state.kyc.version+1, status:"DRAFT" };
        overview.kyc = state.kyc; return reply(state.kyc);
      }
      if (url.pathname === "/api/kyc/files") {
        const kind=options.body.get("kind");
        state.kyc.files = [...state.kyc.files.filter(f=>f.kind!==kind), {id:kind,kind,mimeType:"image/png",size:68,url:"/api/kyc/files/fixture"}];
        state.kyc.version++; return reply(state.kyc);
      }
      if (url.pathname === "/api/kyc/submit") {
        state.kyc.status="PENDING"; state.kyc.submittedAt=new Date().toISOString(); overview.kyc=state.kyc;
        return reply(state.kyc);
      }
      if (url.pathname === "/api/investments") {
        if (state.failInvestment) { state.failInvestment = false; return reply("Temporary failure. Please try again.", 503); }
        overview.accrual.items = [{id:"fixture-investment",plan:overview.plans[0].name,payoutInterval:"MONTHLY",monthlyRate:"3.5%",principal:"$1,000.00",monthlyProfit:"$35.00",startedAt:new Date().toISOString(),endsAt:null,pending:"$0.0000",paid:"$0.00"}];
        return reply({investment:{id:"fixture-investment"},created:true});
      }
      if (url.pathname === "/api/withdrawals") {
        state.withdrawals = [{id:"fixture-withdrawal",type:"WITHDRAWAL",label:"Withdrawal request",amount:"$50.00",status:"PENDING",method:body.method,note:body.details,reference:body.reference,createdAt:new Date().toISOString()}];
        return reply({request:{id:"fixture-withdrawal"},created:true,status:"PENDING"});
      }
      if (url.pathname === "/api/loans") {
        const loan = {id:"fixture-loan",type:body.type,currency:body.currency,amountCents:100000,status:"PENDING",createdAt:new Date().toISOString(),dueDate:null};
        state.loans = [loan]; return reply(loan);
      }
      if (url.pathname === "/api/deposits") return reply({request:{id:"fixture-deposit"},created:true,status:"PENDING"});
      if (url.pathname === "/api/reviews") return reply({submitted:true,status:"PENDING"});
      throw new Error("Unexpected POST in UI check: " + url.pathname);
    }
    if (url.pathname === "/api/dashboard/overview") return reply(overview);
    if (url.pathname === "/api/investments") return reply({items:state.completed,nextCursor:null});
    if (url.pathname === "/api/kyc") return reply(state.kyc);
    if (url.pathname === "/api/loans") return reply(state.loans);
    if (url.pathname === "/api/withdrawals") return reply({items:state.withdrawals,nextCursor:null});
    if (url.pathname === "/api/transactions") {
      if (state.failTransactions) { state.failTransactions=false; return reply("Transactions temporarily unavailable",503); }
      return reply({items:[{id:"fixture-tx",type:"DEPOSIT",label:"Deposit",amount:"$100.00",status:"COMPLETED",method:"Bank Transfer",note:null,reference:"FIXTURE-TX",createdAt:new Date().toISOString()}],nextCursor:null});
    }
    if (url.pathname === "/api/search") return reply({items:[]});
    return original(input, options);
  };
})();`;

const { cdp, sessionId, close } = await launch({ port: 9228 });
const errors = [];
cdp.on("Runtime.exceptionThrown", (event) => errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};
const wait = async (expression, label) => {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
};
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.click(); })()`);
const fill = (selector, value) => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,"value").set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event("input",{bubbles:true}));})()`);
let count = 0;
async function check(label, expression) { assert(await evaluate(expression), label); console.log(`PASS ${label}`); count++; }
async function screenshot(name) {
  await evaluate('Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect.getTiming().iterations)).map(animation => animation.finished.catch(() => {})))');
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
  writeFileSync(`scripts/shots/${name}.png`, Buffer.from(data, "base64"));
}

try {
  mkdirSync("scripts/shots", { recursive: true });
  await cdp.send("Network.setCookie", { name: "qfs_session", value: cookie, url: base, httpOnly: true }, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: stub }, sessionId);
  if (!process.argv.includes("--german-only")) {
  await cdp.send("Page.navigate", { url: `${base}${root}/investments` }, sessionId);
  await wait('document.querySelector(".dash-page-header h1")?.textContent === "Active Investments" && !!window.__dashboardCheck', "investment page");
  await wait('window.__dashboardCheck.mounted === true', "client hydration");
  await wait('document.querySelector(".dash-investment-history")?.textContent.includes("QFS Completed Plan")', "completed investment history");
  await check("Completed investment history distinguishes pending principal", 'document.querySelector(".dash-investment-history").textContent.includes("Awaiting admin release")');
  await click(".dash-investment-history summary");
  await check("Completed investment retains terms and supporting documents", 'document.querySelector(".dash-investment-history details").open && document.querySelector(".dash-investment-history").textContent.includes("Original plan conditions") && document.querySelector(".dash-investment-history .dash-position-documents a").getAttribute("href") === "/api/documents/files/fixture.pdf"');
  await check("Direct investment route has active navigation", 'document.querySelector(".dash-sb-link[aria-current=page]")?.textContent.includes("Investments")');
  await click(".dash-page-header .dash-btn");
  await wait('!!document.querySelector("#inv-amount")', "investment form");
  await click(".dash-modal-body .dash-form-group:nth-child(2) button");
  await fill("#inv-amount", "1000");
  await click(".dash-modal-body > .dash-btn");
  await sleep(100);
  await check("Submission shows spinner and disables form", '!!document.querySelector(".dash-modal .dash-spinner") && document.querySelector(".dash-form-fieldset").disabled');
  await click(".dash-modal-body > .dash-btn");
  await wait('!!document.querySelector(".dash-form-error")', "inline error");
  await check("Failed investment keeps values and only sends once", 'document.querySelector("#inv-amount").value === "1000" && window.__dashboardCheck.posts.length === 1');
  await click(".dash-modal-body > .dash-btn");
  await wait('!!document.querySelector(".dash-record-saved") && !document.querySelector(".dash-modal")', "saved investment");
  await check("Investment success is persistent and record visible", 'document.querySelector(".dash-success-message").textContent.includes("Investment started") && document.querySelector(".dash-record-saved").textContent.includes("$1,000.00")');
  await check("Retry uses the same investment reference", 'window.__dashboardCheck.posts[0].body.reference === window.__dashboardCheck.posts[1].body.reference');
  await screenshot("account-investments-desktop");

  await click(`.dash-sb-link[href='${root}/transactions']`);
  await wait('document.querySelector(".dash-page-header h1")?.textContent === "Transactions"', "transactions page");
  await check("Transactions displays loading skeleton", '!!document.querySelector(".dash-list-skeleton")');
  await wait('document.querySelector(".dash-load-error")?.textContent.includes("Transactions temporarily unavailable")', "transaction error");
  await click(".dash-load-error button");
  await wait('document.querySelector(".dash-tx-list")?.textContent.includes("Deposit") && !document.querySelector(".dash-load-error")', "transaction retry");
  await check("Retry loads the transaction history", '!document.querySelector(".dash-load-error") && !!document.querySelector(".dash-tx-item")');
  await evaluate("history.back()");
  await wait('document.querySelector(".dash-page-header h1")?.textContent === "Active Investments"', "back navigation");
  await check("Browser back restores active destination", 'document.querySelector(".dash-sb-link[aria-current=page]")?.textContent.includes("Investments")');

  await click(`.dash-sb-link[href='${root}/withdrawals']`);
  await wait('document.querySelector(".dash-page-header h1")?.textContent === "Withdrawals"', "withdrawals page");
  await click(".dash-page-header .dash-btn");
  await fill("#wd-amount", "50");
  await fill("#wd-details", "Fixture bank destination");
  await click(".dash-modal-body > .dash-btn");
  await wait('document.querySelector(".dash-record-saved")?.textContent.includes("Pending review")', "pending withdrawal");
  await check("Withdrawal confirms reserved balance and pending status", 'document.querySelector(".dash-success-message")?.textContent.includes("reserved") && !document.querySelector(".dash-modal")');

  await click(`.dash-sb-link[href='${root}/loans']`);
  await wait('document.querySelector(".dash-page-header h1")?.textContent === "Loans"', "loans page");
  await click(".dash-page-header .dash-btn");
  await fill("#loan-amount", "1000");
  await fill("#loan-occ", "Designer");
  await click(".dash-modal-body > .dash-btn");
  await wait('document.querySelector(".dash-record-saved")?.textContent.includes("Pending review")', "pending loan");
  await check("Loan application leads to saved pending record", 'document.querySelector(".dash-success-message")?.textContent.includes("Loan application submitted")');

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  await check("Mobile workspace has no horizontal overflow", 'document.documentElement.scrollWidth <= innerWidth');
  await click(".dash-hamburger");
  await check("Mobile menu opens", 'document.querySelector(".qfs-dash").classList.contains("sidebar-open")');
  await click(`.dash-sb-link[href='${root}/investments']`);
  await wait('document.querySelector(".dash-page-header h1")?.textContent === "Active Investments"', "mobile navigation");
  await check("Mobile destination closes menu", '!document.querySelector(".qfs-dash").classList.contains("sidebar-open") && document.documentElement.scrollWidth <= innerWidth');
  await screenshot("account-investments-mobile");
  await click(".dash-page-header .dash-btn");
  await wait('!!document.querySelector(".dash-modal") && document.activeElement?.id === "inv-from"', "dialog focus");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" }, sessionId);
  await wait('!document.querySelector(".dash-modal")', "escape dismisses dialog");
  await check("Dialog returns focus to its trigger", 'document.activeElement === document.querySelector(".dash-page-header .dash-btn")');
  await evaluate(`document.querySelector(".dash-sb-link[href='${root}']").click()`);
  await wait('!!document.querySelector(".dash-welcome")', "dashboard");
  await check("Dashboard stays uncluttered with a separate Active Investments menu", `!Array.from(document.querySelectorAll(".dash-balance-card")).some(el=>el.textContent.includes("Active Loans")) && !document.querySelector(".dash-dashboard-investments") && document.querySelector('.dash-sb-nav a[href="/user/user/dashboard/investments"]').textContent.includes("Active Investments")`);
  await check("Unverified account has a subtle KYC prompt", '!!document.querySelector(".dash-kyc-banner a")');
  await screenshot("account-dashboard-mobile");
  await click(".dash-kyc-banner a");
  await wait('!!document.querySelector("#kyc-name")', "KYC form");
  await check("KYC page is accessible without mobile overflow", 'document.querySelector(".dash-page-header h1").textContent === "Identity verification" && document.documentElement.scrollWidth <= innerWidth');
  await fill("#kyc-birth", "1992-05-10");
  await fill("#kyc-country", "Nigeria");
  await fill("#kyc-address", "10 Example Street, Lagos");
  await click(".dash-kyc-flow form .dash-btn");
  await wait('document.querySelectorAll(".dash-kyc-upload").length === 2', "KYC document step");
  await evaluate(`(() => { const file=new File([new Uint8Array([137,80,78,71])],"fixture.png",{type:"image/png"});document.querySelectorAll("input[type=file]").forEach(input=>{ const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true})); }); })()`);
  await wait('document.querySelectorAll(".dash-kyc-upload a").length >= 1', "first secure upload");
  await evaluate(`(() => { const input=Array.from(document.querySelectorAll(".dash-kyc-upload")).find(row=>!row.querySelector("a"))?.querySelector("input");if(input){ const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([137,80,78,71])],"fixture.png",{type:"image/png"}));input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true})); } })()`);
  await wait('document.querySelectorAll(".dash-kyc-upload a").length === 2', "second secure upload");
  await click(".dash-kyc-flow .dash-actions-row .dash-btn.primary");
  await wait('!!document.querySelector(".dash-kyc-consent")', "KYC review step");
  await check("KYC submission requires consent", 'document.querySelector(".dash-kyc-flow .dash-actions-row .dash-btn.primary").disabled');
  await click(".dash-kyc-consent input");
  await click(".dash-kyc-flow .dash-actions-row .dash-btn.primary");
  await wait('document.querySelector(".dash-kyc-status h2")?.textContent === "Documents submitted"', "KYC pending confirmation");
  await check("KYC shows saved review status", 'document.querySelector(".dash-kyc-status").textContent.includes("awaiting admin review")');
  await screenshot("account-kyc-mobile");
  await cdp.send("Page.navigate", {url:`${base}/admin/kyc`}, sessionId);
  await wait('Array.from(document.querySelectorAll("button")).some(button=>button.textContent === "Review submission")', "admin review queue");
  await evaluate('Array.from(document.querySelectorAll("button")).find(button=>button.textContent === "Review submission").click()');
  await wait('document.querySelector(".adm-kyc-details")?.textContent.includes("Example Investor")', "admin private review");
  await check("Admin review requires confirmation before approval", 'Array.from(document.querySelectorAll("button")).find(button=>button.textContent === "Approve identity").disabled');
  await check("Mobile review document links fit the dialog", 'Array.from(document.querySelectorAll(".adm-kyc-files a")).every(link => link.scrollWidth <= link.clientWidth + 1 && link.getBoundingClientRect().right <= document.querySelector(".adm-modal").getBoundingClientRect().right)');
  await screenshot("admin-kyc-review-mobile");
  await click(".adm-modal input[type=checkbox]");
  await evaluate('Array.from(document.querySelectorAll("button")).find(button=>button.textContent === "Approve identity").click()');
  await wait('document.querySelector(".adm-modal .adm-banner")?.textContent.includes("Approved. The account is verified.")', "admin approval result");
  await check("Admin decision displays its saved result", 'document.querySelector(".adm-modal").textContent.includes("Approved. The account is verified.") && document.documentElement.scrollWidth <= innerWidth');
  await cdp.send("Page.navigate", {url:`${base}/admin/investments`}, sessionId);
  await wait('Array.from(document.querySelectorAll("button")).some(button=>button.textContent === "Review release")', "principal release queue");
  await evaluate('Array.from(document.querySelectorAll("button")).find(button=>button.textContent === "Review release").click()');
  await wait('document.querySelector(".adm-modal")?.textContent.includes("Total balance remains unchanged")', "principal release review");
  await screenshot("admin-principal-release-mobile");
  await check("Principal release review explains the balance treatment", 'document.querySelector(".adm-modal").textContent.includes("$1,000.00") && document.querySelector(".adm-modal").textContent.includes("Profit was settled separately") && document.documentElement.scrollWidth <= innerWidth');
  await click(".adm-modal-actions .adm-btn.primary");
  await check("Principal release shows progress and prevents repeated clicks", 'document.querySelector(".adm-modal-actions .adm-btn.primary").disabled && document.querySelector(".adm-modal-actions .adm-btn.primary").textContent === "Releasing principal…"');
  await click(".adm-modal-actions .adm-btn.primary");
  await wait('document.querySelector(".adm-banner")?.textContent.includes("principal released") && !document.querySelector(".adm-modal")', "principal release result");
  await check("Principal release success persists and submits once", 'window.__dashboardCheck.posts.filter(post=>post.path === "/api/admin/investments/fixture-matured").length === 1 && document.querySelector(".adm-banner").textContent.includes("available balance")');
  await cdp.send("Network.deleteCookies", {name:"qfs_session",url:base}, sessionId);
  await cdp.send("Page.navigate", {url:`${base}/user/user/login`}, sessionId);
  await wait('!!Array.from(document.querySelectorAll("a")).find(link=>link.getAttribute("href") === "/forgot-password")', "user recovery link");
  await check("User sign in links to account recovery", '!!Array.from(document.querySelectorAll("a")).find(link=>link.getAttribute("href") === "/forgot-password")');
  await evaluate('Array.from(document.querySelectorAll("a")).find(link=>link.getAttribute("href") === "/forgot-password").click()');
  await wait('!!document.querySelector("#recovery-email")', "email recovery form");
  await fill("#recovery-email", "fixture@example.test");
  await click(".auth-recovery-fields .auth-submit");
  await check("Recovery request displays progress and disables inputs", 'document.querySelector(".auth-recovery-fields").disabled && !!document.querySelector(".auth-submit-spinner")');
  await click(".auth-recovery-fields .auth-submit");
  await wait('document.querySelector(".auth-form-error")?.textContent.includes("temporarily unavailable")', "recovery delivery error");
  await check("Recovery delivery error preserves email and submits once", 'document.querySelector("#recovery-email").value === "fixture@example.test" && window.__dashboardCheck.posts.filter(post=>post.path === "/api/auth/forgot-password").length === 1');
  await check("Recovery form fits a phone screen", 'document.documentElement.scrollWidth <= innerWidth');
  await screenshot("account-recovery-mobile");
  await click(".auth-recovery-fields .auth-submit");
  await wait('document.querySelector(".auth-recovery-result h2")?.textContent === "Check your email"', "generic recovery confirmation");
  await check("Recovery confirmation explains expiry without exposing a link", 'document.querySelector(".auth-recovery-result").textContent.includes("30 minutes") && !document.querySelector("a[href*=token]")');
  await cdp.send("Page.navigate", {url:`${base}/reset-password`}, sessionId);
  await wait('document.querySelector(".auth-recovery-result h2")?.textContent === "Recovery link missing"', "missing reset token");
  await check("Missing recovery links guide the user to request a new one", '!document.querySelector("#recovery-password") && !!document.querySelector(".auth-recovery-result a")');
  await cdp.send("Page.navigate", {url:`${base}/reset-password#token=${"1".repeat(64)}`}, sessionId);
  await wait('!!document.querySelector("#recovery-password")', "new password form");
  await fill("#recovery-password", "FixtureNewPassword94");
  await fill("#recovery-confirm", "MismatchPassword94");
  await click(".auth-recovery-fields .auth-submit");
  await check("Password mismatch prevents a reset request", 'document.querySelector(".auth-form-error").textContent.includes("do not match") && window.__dashboardCheck.posts.length === 0');
  await fill("#recovery-confirm", "FixtureNewPassword94");
  await click(".auth-recovery-fields .auth-submit");
  await check("Password reset has visible progress", 'document.querySelector(".auth-recovery-fields").disabled && document.querySelector(".auth-submit").textContent.includes("Changing password")');
  await wait('document.querySelector(".auth-form-error")?.textContent.includes("Temporary service failure")', "password reset retry");
  await check("Failed reset preserves the entered password for retry", 'document.querySelector("#recovery-password").value === "FixtureNewPassword94"');
  await cdp.send("Emulation.setDeviceMetricsOverride", {width:1280,height:900,deviceScaleFactor:1,mobile:false}, sessionId);
  await screenshot("account-reset-desktop");
  await click(".auth-recovery-fields .auth-submit");
  await wait('document.querySelector(".auth-recovery-result h2")?.textContent === "Password changed"', "password reset success");
  await check("Reset success clears the private link and password fields", 'location.hash === "" && !document.querySelector("#recovery-password") && document.querySelector(".auth-recovery-result").textContent.includes("signed out")');
  await cdp.send("Page.navigate", {url:`${base}/admin/login`}, sessionId);
  await wait('!!document.querySelector("#admin-email")', "admin sign in");
  await check("Admin sign in links to the same recovery flow", '!!Array.from(document.querySelectorAll("a")).find(link=>link.getAttribute("href") === "/forgot-password")');
  await cdp.send("Page.navigate", {url:`${base}/forgot-password`}, sessionId);
  await wait('!!document.querySelector("#recovery-email") && !!document.querySelector(".language-selector select")', "language selector");
  await fill("#recovery-email", "fixture@example.test");
  await evaluate('(() => {const select=document.querySelector(".language-selector select");select.value="es";select.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await wait('document.documentElement.lang === "es" && document.querySelector(".auth-head h1")?.textContent === "¿Olvidaste tu contraseña?"', "Spanish recovery page");
  await check("Language switching translates the form and preserves entered email", 'document.querySelector("#recovery-email").value === "fixture@example.test" && document.querySelector(".auth-submit").textContent.includes("Enviar enlace")');
  await cdp.send("Page.reload", {}, sessionId);
  await wait('document.documentElement?.lang === "es" && !!document.querySelector("#recovery-email")', "saved language reload");
  await check("Saved language is rendered on the server after reload", 'document.querySelector(".auth-head h1").textContent === "¿Olvidaste tu contraseña?" && document.documentElement.dir === "ltr"');
  await cdp.send("Emulation.setDeviceMetricsOverride", {width:390,height:844,deviceScaleFactor:1,mobile:true}, sessionId);
  await check("Translated recovery fits a phone screen", 'document.documentElement.scrollWidth <= innerWidth');
  await screenshot("account-recovery-spanish-mobile");
  await cdp.send("Network.setCookie", {name:"qfs_session",value:cookie,url:base,httpOnly:true}, sessionId);
  await cdp.send("Page.navigate", {url:`${base}${root}/verification`}, sessionId);
  await wait('document.querySelector(".dash-page-header h1")?.textContent === "Verificación de identidad" && !!document.querySelector("#kyc-name")', "Spanish verification");
  await check("Spanish account navigation and KYC form render without overflow", 'document.querySelector(".dash-sb-link[aria-current=page]")?.textContent.includes("Verificación de identidad") && document.querySelector("#kyc-name").value.length > 0 && document.documentElement.scrollWidth <= innerWidth');
  await screenshot("account-kyc-spanish-mobile");
  await cdp.send("Page.navigate", {url:`${base}${root}/investments`}, sessionId);
  await wait('document.querySelector(".dash-page-header h1")?.textContent === "Inversiones" && window.__dashboardCheck?.mounted && !!document.querySelector(".dash-page-header button")', "Spanish investment form");
  await click(".dash-page-header button");
  await wait('!!document.querySelector("#inv-amount")', "localized amount input");
  await check("Spanish investment amount uses a local decimal placeholder", 'document.querySelector("#inv-amount").placeholder === "100,00"');
  await click(".dash-modal-body .dash-form-group:nth-child(2) button");
  await fill("#inv-amount", "1.000,50");
  await evaluate('window.__dashboardCheck.failInvestment=false');
  await click(".dash-modal-body > .dash-btn");
  await wait('window.__dashboardCheck.posts.length === 1 && !document.querySelector(".dash-modal")', "Spanish investment submitted");
  await check("Spanish amount submits the intended USD value", 'window.__dashboardCheck.posts[0].body.amount === 1000.5');
  await cdp.send("Page.navigate", {url:`${base}/admin/plans`}, sessionId);
  await wait('document.querySelector(".adm-actions-cell button")?.textContent === "Editar"', "Spanish admin plans");
  await click(".adm-actions-cell button");
  await wait('!!document.querySelector(".adm-plan-translations")', "plan language editor");
  await click(".adm-plan-translations > summary");
  await fill(".adm-plan-translations textarea:nth-of-type(1)", "Descripción original");
  await check("Unreviewed translation edits prevent publishing the plan", 'Array.from(document.querySelectorAll(".adm-modal button")).find(button=>button.textContent === "Guardar cambios").disabled');
  await fill(".adm-plan-translations .adm-field:nth-of-type(2) textarea", "Condiciones originales");
  await fill(".adm-plan-translations .adm-field:nth-of-type(3) textarea", "El capital está en riesgo");
  await evaluate('Array.from(document.querySelectorAll(".adm-plan-translations button")).find(button=>button.textContent === "Usar traducción revisada").click()');
  await wait('document.querySelector(".adm-plan-translations").textContent.includes("coincide con los materiales")', "reviewed language version");
  await check("Reviewed language version allows publishing", '!Array.from(document.querySelectorAll(".adm-modal button")).find(button=>button.textContent === "Guardar cambios").disabled');
  await screenshot("admin-plan-language-mobile");
  await evaluate('Array.from(document.querySelectorAll(".adm-modal button")).find(button=>button.textContent === "Guardar cambios").click()');
  await wait('!document.querySelector(".adm-modal") && window.__dashboardCheck.posts.length === 1', "plan language saved");
  await check("Language publication preserves financial values and canonical source fingerprint", '(() => {const body=window.__dashboardCheck.posts[0].body;return body.monthlyRoiPct === 3.5 && body.minAmount === 100 && body.termMonths === 3 && body.translations.es.terms === "Condiciones originales" && body.translations.es.sourceHash === "d9183e1a41200b8188f0762899cc4ad7b3117b35d9378447a33761fa52dfcb90";})()');
  await cdp.send("Network.setCookie", {name:"qfs_session",value:"",url:base,httpOnly:true}, sessionId);
  await cdp.send("Page.navigate", {url:`${base}/forgot-password`}, sessionId);
  await wait('!!document.querySelector(".language-selector select") && Object.keys(document.querySelector(".language-selector select")).some(key=>key.startsWith("__reactProps"))', "hydrated language selector");
  await fill("#recovery-email", "fixture@example.test");
  await evaluate('(() => {const select=document.querySelector(".language-selector select");select.value="fr";select.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await wait('document.documentElement.lang === "fr" && document.querySelector(".auth-head h1")?.textContent === "Mot de passe oublié ?"', "French recovery");
  await check("French recovery preserves form values and fits mobile", 'document.querySelector("#recovery-email").value === "fixture@example.test" && document.documentElement.scrollWidth <= innerWidth && document.title.includes("Récupération du compte")');
  await screenshot("account-recovery-french-mobile");
  await wait('!document.querySelector(".language-selector select").disabled', "French language transition finished");
  await evaluate('(() => {const select=document.querySelector(".language-selector select");select.value="ar";select.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await wait('document.documentElement.lang === "ar" && document.querySelector(".auth-head h1")?.textContent === "هل نسيت كلمة المرور؟"', "Arabic recovery");
  await check("Arabic recovery uses RTL while retaining email direction and values", 'document.documentElement.dir === "rtl" && getComputedStyle(document.querySelector("#recovery-email")).direction === "ltr" && document.querySelector("#recovery-email").value === "fixture@example.test" && document.documentElement.scrollWidth <= innerWidth');
  await screenshot("account-recovery-arabic-mobile");
  await cdp.send("Page.reload", {}, sessionId);
  await wait('document.documentElement?.lang === "ar" && !!document.querySelector("#recovery-email")', "saved Arabic reload");
  await check("Saved Arabic is rendered on the server with translated metadata", 'document.documentElement.dir === "rtl" && document.title.includes("استعادة الحساب") && document.querySelector(".auth-head h1").textContent === "هل نسيت كلمة المرور؟"');
  await cdp.send("Network.setCookie", {name:"qfs_session",value:cookie,url:base,httpOnly:true}, sessionId);
  await cdp.send("Page.navigate", {url:`${base}${root}/verification`}, sessionId);
  await wait('document.querySelector(".dash-page-header h1")?.textContent === "التحقق من الهوية" && window.__dashboardCheck?.mounted && !!document.querySelector("#kyc-name")', "Arabic KYC");
  await check("Arabic KYC form and navigation fit mobile", 'document.querySelector(".dash-sb-link[aria-current=page]")?.textContent.includes("التحقق من الهوية") && document.documentElement.scrollWidth <= innerWidth');
  await click(".dash-hamburger");
  await wait('document.querySelector(".qfs-dash").classList.contains("sidebar-open")', "Arabic mobile menu open");
  await evaluate('Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{})))');
  await check("Arabic mobile menu opens from the right edge", '(() => {const box=document.querySelector(".dash-sidebar").getBoundingClientRect();return Math.abs(box.right-innerWidth)<2 && box.left>0;})()');
  await screenshot("account-kyc-arabic-menu-mobile");
  await click(".dash-sb-close");
  await cdp.send("Page.navigate", {url:`${base}${root}/investments`}, sessionId);
  await wait('document.querySelector(".dash-page-header h1")?.textContent === "الاستثمارات النشطة" && window.__dashboardCheck?.mounted', "Arabic investment page");
  await wait('document.querySelector(".dash-investment-history")?.textContent.includes("QFS Completed Plan")', "Arabic completed investment history");
  await check("Investment duration uses Arabic singular wording", 'document.querySelector(".dash-investment-history").textContent.includes("شهر واحد")');
  await click(".dash-page-header button");
  await wait('!!document.querySelector("#inv-amount")', "Arabic investment modal");
  await click(".dash-modal-body .dash-form-group:nth-child(2) button");
  await fill("#inv-amount", "١٬٠٠٠٫٥٠");
  await check("Arabic investment dialog fits mobile", 'document.documentElement.scrollWidth <= innerWidth && document.querySelector(".dash-modal").getBoundingClientRect().width <= innerWidth');
  await screenshot("account-investment-arabic-mobile");
  await evaluate('window.__dashboardCheck.failInvestment=false');
  await click(".dash-modal-body > .dash-btn");
  await wait('window.__dashboardCheck.posts.length === 1 && !document.querySelector(".dash-modal")', "Arabic investment submitted");
  await check("Arabic digits submit the intended USD amount", 'window.__dashboardCheck.posts[0].body.amount === 1000.5');
  await cdp.send("Page.navigate", {url:`${base}/admin/plans`}, sessionId);
  await wait('document.querySelector(".adm-actions-cell button")?.textContent === "تعديل"', "Arabic admin plans");
  await check("Arabic admin plans fit mobile", 'document.documentElement.scrollWidth <= innerWidth');
  await click(".adm-actions-cell button");
  await wait('!!document.querySelector(".adm-plan-translations")', "Arabic plan editor");
  await check("Arabic plan dialog fits mobile", 'document.documentElement.scrollWidth <= innerWidth && document.querySelector(".adm-modal").getBoundingClientRect().width <= innerWidth');
  await screenshot("admin-plan-arabic-mobile");
  await click(".adm-modal-close");
  await cdp.send("Emulation.setDeviceMetricsOverride", {width:1280,height:900,deviceScaleFactor:1,mobile:false}, sessionId);
  await wait('innerWidth === 1280 && getComputedStyle(document.querySelector(".adm-sidebar")).transform === "none"', "Arabic desktop resize");
  await check("Arabic desktop admin sidebar reserves space on the right", '(() => {const sidebar=document.querySelector(".adm-sidebar").getBoundingClientRect();const main=document.querySelector(".adm-main").getBoundingClientRect();return Math.abs(sidebar.right-innerWidth)<2 && main.right<=sidebar.left+2 && main.left>=0;})()');
  await screenshot("admin-plans-arabic-desktop");
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", {width:390,height:844,deviceScaleFactor:1,mobile:true}, sessionId);
  await cdp.send("Network.setCookie", {name:"qfs_locale",value:"de",url:base,httpOnly:true}, sessionId);
  await cdp.send("Page.navigate", {url:`${base}${root}/verification`}, sessionId);
  await wait('document.querySelector(".dash-page-header h1")?.textContent === "Identitätsprüfung" && window.__dashboardCheck?.mounted && !!document.querySelector("#kyc-name")', "German KYC");
  await check("German KYC and account navigation fit mobile", 'document.documentElement.lang === "de" && document.documentElement.dir === "ltr" && document.documentElement.scrollWidth <= innerWidth && document.querySelector(".dash-sb-link[aria-current=page]")?.textContent.includes("Identitätsprüfung")');
  await screenshot("account-kyc-german-mobile");
  await cdp.send("Page.navigate", {url:`${base}${root}/investments`}, sessionId);
  await wait('document.querySelector(".dash-page-header h1")?.textContent === "Aktive Anlagen" && window.__dashboardCheck?.mounted', "German investment page");
  await click(".dash-page-header button");
  await wait('!!document.querySelector("#inv-amount")', "German amount entry");
  await click(".dash-modal-body .dash-form-group:nth-child(2) button");
  await fill("#inv-amount", "1.000,50");
  await check("German investment form shows local decimals and fits mobile", 'document.querySelector("#inv-amount").placeholder === "100,00" && document.documentElement.scrollWidth <= innerWidth');
  await screenshot("account-investment-german-mobile");
  await evaluate('window.__dashboardCheck.failInvestment=false');
  await click(".dash-modal-body > .dash-btn");
  await wait('window.__dashboardCheck.posts.length === 1 && !document.querySelector(".dash-modal")', "German amount submitted");
  await check("German notation submits the intended USD amount", 'window.__dashboardCheck.posts[0].body.amount === 1000.5');
  await cdp.send("Page.navigate", {url:`${base}/admin/plans`}, sessionId);
  await wait('document.querySelector(".adm-actions-cell button")?.textContent === "Bearbeiten"', "German admin plans");
  await click(".adm-actions-cell button");
  await wait('!!document.querySelector(".adm-plan-translations")', "German plan editor");
  await check("German plan editor retains its rate and fits mobile", 'document.documentElement.scrollWidth <= innerWidth && Array.from(document.querySelectorAll(".adm-modal input")).some(input=>input.value === "3,5") && document.querySelector(".adm-crumbs").textContent.includes("Pläne")');
  await screenshot("admin-plan-german-mobile");
  await click(".adm-modal-close");
  await cdp.send("Network.setCookie", {name:"qfs_session",value:"",url:base,httpOnly:true}, sessionId);
  await cdp.send("Page.navigate", {url:`${base}/forgot-password`}, sessionId);
  await wait('document.querySelector(".auth-head h1")?.textContent === "Passwort vergessen?" && !!document.querySelector("#recovery-email")', "German recovery");
  await check("German recovery renders translated metadata and fits mobile", 'document.title.includes("Kontowiederherstellung") && document.documentElement.scrollWidth <= innerWidth');
  await screenshot("account-recovery-german-mobile");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(`PASS ${count} browser interaction checks; no runtime exceptions`);
} catch (error) {
  await screenshot("account-interactions-failure");
  console.error(await evaluate('({path:location.pathname,text:document.body.innerText.slice(-1500)})'));
  throw error;
} finally { await close(); }
