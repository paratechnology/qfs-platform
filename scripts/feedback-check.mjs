/* Isolated UI checks: account and financial writes are fixtures. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, sleep } from "./lib/cdp.mjs";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const php = code => execFileSync("php", ["-r", `require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); if(!app()->environment('local'))throw new RuntimeException('Local checks only'); ${code}`], { cwd: "server", encoding: "utf8" }).trim();
const token = php("$id=Illuminate\\Support\\Facades\\DB::table('User')->where('role','ADMIN')->where('status','ACTIVE')->value('id');if(!$id)throw new RuntimeException('Active admin required');echo App\\Support\\SessionAuth::issue($id);");
let browser;
let passed = 0;
const errors = [];
try {
  browser = await launch({ port: 9248 });
  const { cdp, sessionId } = browser;
  cdp.on("Runtime.exceptionThrown", params => errors.push(params.exceptionDetails.text));
  cdp.on("Runtime.consoleAPICalled", params => { if (params.type === "error") errors.push(params.args.map(arg => arg.value ?? arg.description ?? "").join(" ")); });
  const evaluate = async expression => {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  async function wait(expression, label) {
    for (let i = 0; i < 150; i++) { if (await evaluate(`!!(${expression})`)) return; await sleep(400); }
    throw Error("Timed out: " + label);
  }
  async function check(label, expression) { assert(await evaluate(expression), label); passed++; console.log("PASS " + label); }
  async function go(path, selector) {
    await cdp.send("Page.navigate", { url: base + path }, sessionId);
    await wait(`location.pathname===${JSON.stringify(path.split("?")[0])} && document.querySelector(${JSON.stringify(selector)})`, path);
  }
  async function fill(selector, value) {
    await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Missing field');Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  }
  async function click(label, selector = "button") {
    await evaluate(`(()=>{const button=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Missing control: '+${JSON.stringify(label)});button.click();})()`);
  }
  async function shot(name) {
    const result = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(`scripts/shots/${name}.png`, Buffer.from(result.data, "base64"));
  }
  mkdirSync("scripts/shots", { recursive: true });
  const injection = `(()=>{
    const original=window.fetch.bind(window);
    const state=window.__feedback={writes:[],blocked:[],hold:false,failRegistration:true,failProfile:true,failReview:true,status:'PENDING'};
    state.crypto=new URLSearchParams(location.search).has('crypto');state.seedHash=new URLSearchParams(location.search).get('hash');
    state.race=new URLSearchParams(location.search).has('race');
    const user={id:'feedback-user',name:'Example Member',email:'member@example.test',phone:'+2348000000000',country:'Nigeria',avatarUrl:'/avatars/avatar1.jpg',role:'USER',status:'ACTIVE',kycLevel:1,balanceCents:100000,availableCents:100000,depositCents:100000,withdrawalCents:0,memberSince:'2026-10-01T00:00:00Z',lastLoginAt:null,referralCode:'EXAMPLE',referredCount:0,walletAddress:null};
    const reply=(data,status=200)=>new Response(JSON.stringify(status===200?{ok:true,data}:{ok:false,error:{message:data}}),{status,headers:{'Content-Type':'application/json'}});
    window.fetch=async(input,options={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.origin),method=options.method??'GET',body=typeof options.body==='string'?JSON.parse(options.body):{};
      if(url.origin!==location.origin){state.blocked.push(url.href);throw Error('External write blocked');}
      if(method!=='GET'){state.writes.push({path:url.pathname,body});if(state.hold)await new Promise(resolve=>state.release=resolve);await new Promise(resolve=>setTimeout(resolve,300));}
      if(url.pathname==='/api/auth/check-email')return reply({available:true});
      if(url.pathname==='/api/auth/register')return state.failRegistration?reply('An account with this email already exists.',409):reply({registered:true,user:{id:'fixture',role:'USER'}});
      if(url.pathname==='/api/auth/login')return reply('Invalid email or password',401);
      if(url.pathname==='/api/admin/users')return reply({items:[user],total:1,totalPages:1});
      if(url.pathname==='/api/admin/users/feedback-user')return state.failProfile?reply('Your current password is incorrect.',400):reply({changed:true,sessionsRevoked:true});
      if(url.pathname==='/api/admin/requests'&&method==='GET'){
        const kind=url.searchParams.get('type');
        if(state.race&&kind==='DEPOSIT'&&state.holdDepositRead)await new Promise(resolve=>state.releaseDepositRead=resolve);
        return reply({items:[{id:state.race?kind+'-race':'feedback-request',userId:user.id,userName:user.name,userEmail:user.email,amountCents:10000,amount:'$100.00',method:'Bank',reference:state.race?kind+'-REFERENCE':'WD-FEEDBACK',status:state.status,createdAt:'2026-10-17T10:00:00Z',...(state.crypto?{assetKey:'ETH',quantity:'0.5',symbol:'ETH',network:'Ethereum',receivingAddress:'0x'+'1'.repeat(40),txHash:state.seedHash}: {})}],total:1,totalPages:1});
      }
      if(url.pathname==='/api/admin/requests/feedback-request'||(state.race&&url.pathname.startsWith('/api/admin/requests/'))){
        if(state.race&&!url.pathname.endsWith(url.searchParams.get('type')+'-race'))return reply('Incorrect request type',404);
        const reference='txHash' in body?body.txHash:state.seedHash;
        if(state.crypto&&body.action==='APPROVE'&&reference&&!/^0x[a-f0-9]{64}$/i.test(reference))return reply('Enter a valid transaction hash for this network.',400);
        if(state.failReview)return reply('This request was already reviewed',409);
        state.status=body.action==='APPROVE'?'APPROVED':'REJECTED';return reply({decided:true,status:state.status,alreadyReviewed:!!state.alreadyReviewed});
      }
      if(url.pathname==='/api/admin/loans'&&method==='GET')return reply({items:[{id:'feedback-loan',userName:user.name,userEmail:user.email,amountCents:10000,amount:'$100.00',currency:'USD',type:'Personal',period:12,status:state.status,createdAt:'2026-10-17T10:00:00Z'}],total:1,totalPages:1});
      if(url.pathname==='/api/admin/loans/feedback-loan'){state.status='ACTIVE';return reply({decided:true,status:'ACTIVE'});}
      if(url.pathname==='/api/admin/settings')return method==='GET'?reply([]):reply({saved:true});
      if(url.pathname==='/api/admin/audit')return reply({items:[],total:0,totalPages:1});
      if(method!=='GET'){state.blocked.push(url.pathname);throw Error('Unstubbed mutation blocked');}
      return original(input,options);
    };
    window.ethereum={request:async()=>{throw Error('Wallet RPC blocked');}};
  })()`;
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: injection }, sessionId);
  await cdp.send("Network.setCookie", { name: "qfs_locale", value: "en", url: base }, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  await go("/user/user/register", "#register-first");
  await wait('Object.keys(document.querySelector(".auth-form")).some(key=>key.startsWith("__reactProps$")&&document.querySelector(".auth-form")[key].onSubmit)', "hydrated registration");
  for (const [selector, value] of [["#register-first","Example"],["#register-last","Member"],["#register-email","member@example.test"],["#register-phone","+2348000000000"],["#register-password","ExamplePass94"],["#register-confirm","ExamplePass94"]]) await fill(selector, value);
  await evaluate('__feedback.hold=true');
  await click("Create Account", ".auth-submit");
  await wait('__feedback.release', "registration request");
  await evaluate('document.querySelector(".auth-form").requestSubmit()');
  await check("registration shows a spinner, locks fields and prevents duplicate submissions", 'document.querySelector("#register-first").matches(":disabled")&&document.querySelector(".auth-submit .action-spinner")&&__feedback.writes.filter(row=>row.path==="/api/auth/register").length===1');
  await evaluate('__feedback.hold=false;__feedback.release();void 0');
  await wait('document.querySelector(".auth-form-error")', "registration error");
  await check("registration errors retain entered details for correction", 'document.querySelector("#register-first").value==="Example"&&!document.querySelector(".auth-submit").disabled');
  await evaluate('__feedback.failRegistration=false');
  await click("Create Account", ".auth-submit");
  await wait('document.querySelector(".auth-success")', "registration confirmation");
  await check("registration stays on its confirmation and offers explicit login", 'location.pathname==="/user/user/register"&&document.querySelector(".auth-success").textContent.includes("Account registration successful.")&&document.querySelector(".auth-success a").getAttribute("href")==="/user/user/login"&&!document.querySelector(".auth-form")');
  await shot("registration-success-mobile");
  await click("Click here to log in", ".auth-success a");
  await wait('document.querySelector("#login-password")', "login form");
  await check("registration login link opens a form for fresh credentials", 'location.pathname==="/user/user/login"&&document.querySelector("#login-password").value===""');

  await cdp.send("Network.setCookie", { name: "qfs_session", value: token, url: base, httpOnly: true }, sessionId);
  await go("/admin/users", ".adm-table");
  await click("Edit account");
  await wait('document.querySelector("input[name=currentPassword]")', "account editor");
  await check("account editor links to this user's deposits, withdrawals and loans", '[...document.querySelectorAll(".adm-modal nav a")].length===3&&[...document.querySelectorAll(".adm-modal nav a")].every(link=>link.search.includes("userId=feedback-user"))');
  await fill('.adm-modal input[name=name]', "Updated Member");
  await fill('.adm-modal textarea[name=reason]', "Account owner requested this change");
  await fill('.adm-modal input[name=currentPassword]', "ExamplePass94");
  await click("Save account details");
  await wait('document.querySelector(".adm-modal [role=alert]")', "admin password rejection");
  await check("failed account editing preserves inputs and shows the error inside the form", 'document.querySelector(".adm-modal input[name=name]").value==="Updated Member"&&document.querySelector(".adm-modal [role=alert]").textContent.includes("password")');
  await evaluate('__feedback.failProfile=false;__feedback.hold=true');
  await click("Save account details");
  await wait('__feedback.release&&document.querySelector(".adm-modal").getAttribute("aria-busy")==="true"', "pending account save");
  await evaluate('document.querySelector(".adm-modal-close").click()');
  await check("admin writes lock the dialog and its controls until completion", 'document.querySelector(".adm-modal-close").disabled&&document.querySelector(".adm-modal input[name=name]").matches(":disabled")&&!!document.querySelector(".adm-modal-progress .action-spinner")');
  await shot("admin-account-saving-mobile");
  await evaluate('__feedback.hold=false;__feedback.release();void 0');
  await wait('!document.querySelector(".adm-modal")&&document.querySelector(".action-toast.success")', "account updated");
  await check("account update confirms the result, session impact and audit action", 'document.querySelector(".action-toast").textContent.includes("devices were signed out")&&document.querySelector(".action-toast a").getAttribute("href")==="/admin/audit"');
  await check("account editor fits the mobile viewport", 'document.documentElement.scrollWidth<=390');

  await go("/admin/requests?type=WITHDRAWAL&userId=feedback-user", ".adm-table");
  await check("account withdrawal shortcut opens withdrawals with the account filter", 'document.querySelector(".adm-page-head").textContent.includes("Withdrawal Requests")&&document.body.textContent.includes("Showing activity for the selected account.")');
  await click("Approve", ".adm-table button");
  await fill(".adm-modal textarea", "Payment verified");
  await click("Approve $100.00", ".adm-modal button");
  await wait('document.querySelector(".adm-modal [role=alert]")', "review conflict");
  await check("failed reviews keep their dialog, inputs and visible inline error", '!!document.querySelector(".adm-modal")&&document.querySelector(".adm-modal textarea").value==="Payment verified"&&document.querySelector(".adm-modal [role=alert]").textContent.includes("already reviewed")');
  await shot("admin-review-error-mobile");
  await evaluate('__feedback.failReview=false');
  await click("Approve $100.00", ".adm-modal button");
  await wait('!document.querySelector(".adm-modal")&&document.querySelector(".action-toast.success")', "withdrawal approved");
  await check("withdrawal completion updates the status and shows transaction guidance", 'document.querySelector(".action-toast").textContent.includes("Withdrawal approved")&&document.querySelector(".adm-table").textContent.includes("Approved")');

  await go("/admin/requests?crypto=1&hash=mistyped", ".adm-table");
  await evaluate('__feedback.failReview=false');
  await click("Approve", ".adm-table button");
  await wait('document.querySelector("#payout-hash")?.value==="mistyped"', "editable deposit hash");
  await check("An incorrect deposit hash keeps Approve clickable with an idle cursor", '!document.querySelector(".adm-modal .good").disabled&&getComputedStyle(document.querySelector(".adm-modal .good")).cursor==="pointer"');
  await click("Approve 0.5 ETH", ".adm-modal button");
  await wait('document.querySelector(".adm-modal [role=alert]")', "hash format error");
  await check("Malformed supplied hashes show an error inside the editable review form", 'document.querySelector(".adm-modal [role=alert]").textContent.includes("valid transaction hash")&&document.querySelector("#payout-hash").value==="mistyped"&&!document.querySelector(".adm-modal .good").disabled');
  await fill("#payout-hash", "");
  await evaluate('__feedback.hold=true;__feedback.before=__feedback.writes.length;document.querySelector(".adm-modal .good").click();document.querySelector(".adm-modal .good").click()');
  await wait('__feedback.writes.length>__feedback.before', "hashless deposit decision");
  await check("A real approval request alone shows the waiting cursor and prevents double submission", '__feedback.writes.length===__feedback.before+1&&document.querySelector(".adm-modal .good").disabled&&getComputedStyle(document.querySelector(".adm-modal .good")).cursor==="wait"&&!!document.querySelector(".adm-modal-progress .action-spinner")');
  await evaluate('__feedback.hold=false;__feedback.release();void 0');
  await wait('!document.querySelector(".adm-modal")&&document.querySelector(".action-toast.success")', "hashless deposit approved");
  await check("Clearing a mistaken hash approves the deposit and sends an explicit empty hash", '__feedback.writes.at(-1).body.txHash===""&&document.querySelector(".action-toast").textContent.includes("Deposit approved")');

  await go("/admin/requests?type=WITHDRAWAL&crypto=1", ".adm-table");
  await evaluate('__feedback.failReview=false');
  await click("Approve", ".adm-table button");
  await check("Crypto withdrawals can be approved with an optional blank hash", 'document.querySelector("#payout-hash").value===""&&!document.querySelector(".adm-modal .good").disabled');
  await click("Approve 0.5 ETH", ".adm-modal button");
  await wait('!document.querySelector(".adm-modal")&&document.querySelector(".action-toast.success")', "hashless withdrawal approved");
  await check("Hashless withdrawal approval reaches the withdrawal API without rewriting a reference", '!("txHash" in __feedback.writes.at(-1).body)&&document.querySelector(".action-toast").textContent.includes("Withdrawal approved")');

  await go("/admin/requests?crypto=1&hash="+"0x"+"a".repeat(64), ".adm-table");
  await evaluate('__feedback.failReview=false');
  await click("Approve", ".adm-table button");
  await wait('document.querySelector("#payout-hash")?.value.length===66', "unchanged valid hash");
  await click("Approve 0.5 ETH", ".adm-modal button");
  await wait('!document.querySelector(".adm-modal")', "unchanged hash approval");
  await check("An unchanged deposit hash is approved without resubmitting or clearing it", '!("txHash" in __feedback.writes.at(-1).body)&&document.querySelector(".action-toast").textContent.includes("Deposit approved")');

  await go("/admin/requests?crypto=1&race=1", ".adm-table");
  await evaluate('__feedback.failReview=false;__feedback.holdDepositRead=true;window.dispatchEvent(new Event("focus"))');
  await wait('__feedback.releaseDepositRead', "slow deposit refresh");
  await click("Withdrawals", ".adm-seg button");
  await wait('document.querySelector(".adm-table")?.textContent.includes("WITHDRAWAL-REFERENCE")', "withdrawal rows");
  await evaluate('__feedback.holdDepositRead=false;__feedback.releaseDepositRead();void 0');
  await sleep(400);
  await check("A delayed deposit response cannot replace withdrawal rows", 'document.querySelector(".adm-table").textContent.includes("WITHDRAWAL-REFERENCE")&&!document.querySelector(".adm-table").textContent.includes("DEPOSIT-REFERENCE")');
  await click("Approve", ".adm-table button");
  await click("Approve 0.5 ETH", ".adm-modal button");
  await wait('!document.querySelector(".adm-modal")', "correct request type");
  await check("Review keeps the correct request type after tab switching and delayed polling", '__feedback.writes.at(-1).path.endsWith("WITHDRAWAL-race")&&document.querySelector(".action-toast").textContent.includes("Withdrawal approved")');

  await go("/admin/requests?crypto=1", ".adm-table");
  await evaluate('__feedback.failReview=false;__feedback.alreadyReviewed=true');
  await click("Approve", ".adm-table button");
  await click("Approve 0.5 ETH", ".adm-modal button");
  await wait('!document.querySelector(".adm-modal")', "retried completed decision");
  await check("A completed approval retry reports the existing decision instead of a failure", 'document.querySelector(".action-toast.info").textContent.includes("already reviewed")');

  await go("/admin/requests?crypto=1&hash=mistyped", ".adm-table");
  await evaluate('__feedback.failReview=false');
  await click("Reject", ".adm-table button");
  await click("Reject 0.5 ETH", ".adm-modal button");
  await wait('!document.querySelector(".adm-modal")&&document.querySelector(".action-toast.success")', "crypto rejected");
  await check("Rejection remains available independently of a mistaken hash", '__feedback.writes.at(-1).body.action==="REJECT"&&!("txHash" in __feedback.writes.at(-1).body)&&document.querySelector(".action-toast").textContent.includes("Deposit rejected")');

  await go("/admin/loans?userId=feedback-user", ".adm-table");
  await click("Approve", ".adm-table button");
  await click("Approve $100.00", ".adm-modal button");
  await wait('document.querySelector(".action-toast.success")', "loan review confirmation");
  await check("loan review confirms the decision without claiming disbursement", 'document.querySelector(".action-toast").textContent.includes("Loan review completed")&&document.querySelector(".action-toast").textContent.includes("does not disburse funds")');
  await shot("loan-review-success-mobile");
  await check("all browser account and financial writes stayed in fixtures", '__feedback.blocked.length===0');
  assert.deepEqual(errors, [], "No runtime exceptions");
  console.log(`${passed} feedback checks passed`);
} catch (error) {
  if (browser) {
    const result = await browser.cdp.send("Runtime.evaluate", {expression:"JSON.stringify({path:location.pathname,ready:document.readyState,overlay:!!document.querySelector('nextjs-portal')})",returnByValue:true},browser.sessionId).catch(()=>null);
    console.log("Browser state:", result?.result?.value, "Runtime errors:", JSON.stringify(errors));
  }
  throw error;
} finally {
  if (browser) { try { await browser.cdp.send("Network.clearBrowserCookies", {}, browser.sessionId); } catch {} await browser.close(); }
  php(`Illuminate\\Support\\Facades\\DB::table('Session')->where('tokenHash',App\\Support\\SessionAuth::tokenHash('${token}'))->delete();`);
}
process.exit(0);
