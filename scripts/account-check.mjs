/* Account UI checks. Browser mutations are fixtures; no credentials or funds are changed. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {launch,sleep} from "./lib/cdp.mjs";

const base=process.env.BASE_URL??"http://localhost:3000";
const php=code=>execFileSync("php",["-r",`require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); if(!app()->environment('local')) throw new RuntimeException('Local checks only'); ${code}`],{cwd:"server",encoding:"utf8"}).trim();
const cookie=php("$id=Illuminate\\Support\\Facades\\DB::table('User')->where('role','ADMIN')->where('status','ACTIVE')->value('id'); if(!$id) throw new RuntimeException('An active admin is required'); echo App\\Support\\SessionAuth::issue($id);");
const {cdp,sessionId,close}=await launch({port:9246});
const results=[];
const evaluate=async expression=>{const r=await cdp.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
async function wait(expression,label){for(let i=0;i<120;i++){if(await evaluate(`!!(${expression})`))return;await sleep(500);}throw Error("Timed out: "+label);}
async function check(label,expression){assert(await evaluate(expression),label);results.push(label);console.log("PASS "+label);}
async function fill(selector,value){await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Missing input');const setter=Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function click(text,selector="button"){await evaluate(`(()=>{const button=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing button '+${JSON.stringify(text)});button.click();})()`);}
async function shot(name){const r=await cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false},sessionId);writeFileSync(`scripts/shots/${name}.png`,Buffer.from(r.data,"base64"));}
async function go(path){await cdp.send("Page.navigate",{url:base+path},sessionId);}
const injection=`(()=>{
const state=window.__account={writes:[],blocked:[],queries:[],delay:false,enabled:false,reverified:false};
const now='2026-10-16T12:00:00Z';
const record=()=>({id:'kyc-fixture',version:5,status:state.reverified?'NEEDS_CHANGES':'APPROVED',submittedAt:now,reviewedAt:now,reviewNote:state.reverified?'Please upload a renewed document.':null,details:{legalName:'Example Investor',dateOfBirth:'1990-05-10',country:'Nigeria',address:'10 Example Street, Lagos',documentType:'PASSPORT'},files:[{id:'identity',kind:'IDENTITY_FRONT',size:1000,url:'/api/kyc/files/fixture'}]});
const snapshot=()=>({user:{name:'Example Investor',email:'investor@example.test',phone:'+234 8000000000',country:'Nigeria',role:'ADMIN'},twoFactorEnabled:state.enabled,recoveryCodesRemaining:10,sessions:[{id:'current',current:true,ipAddress:'100.64.0.1',userAgent:'Chrome on Windows',createdAt:now,lastSeenAt:now,expiresAt:now},{id:'other',current:false,ipAddress:'100.64.0.2',userAgent:'Safari on iPhone',createdAt:now,lastSeenAt:now,expiresAt:now}]});
const original=window.fetch.bind(window);const response=data=>new Response(JSON.stringify({ok:true,data}),{status:200,headers:{'Content-Type':'application/json'}});
window.fetch=async(input,options={})=>{
const url=new URL(typeof input==='string'?input:input.url,location.origin),method=options.method??'GET',body=options.body?JSON.parse(options.body):null;
if(url.origin!==location.origin){state.blocked.push(url.href);throw Error('External request blocked');}
if(method!=='GET')state.writes.push({path:url.pathname,body});
if(url.pathname==='/api/account/security')return response(snapshot());
if(url.pathname==='/api/account/profile'){if(state.delay)await new Promise(resolve=>state.release=resolve);return response({...snapshot().user,...body});}
if(url.pathname==='/api/account/password'||url.pathname.startsWith('/api/account/sessions/'))return response({changed:true,revoked:1});
if(url.pathname==='/api/account/two-factor/setup')return response({secret:'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',uri:'otpauth://totp/QFS:investor%40example.test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=QFS'});
if(url.pathname==='/api/account/two-factor'){state.enabled=body.action!=='DISABLE';return response({recoveryCodes:['AAAAA-BBBBB-CCCCC-DDDDD','EEEEE-FFFFF-GGGGG-HHHHH']});}
if(url.pathname==='/api/account/statement')return response({from:'2026-10-01',to:'2026-10-16',generatedAt:now,balanceCents:120000,availableCents:20000,transactionCount:2,previewLimited:false,transactions:[{reference:'INV-EXAMPLE',type:'INVESTMENT',status:'COMPLETED',createdAt:now,displayAmount:'$1,000.00',feeCents:0,assetKey:null},{reference:'SWAP-EXAMPLE',type:'SWAP',status:'COMPLETED',createdAt:now,displayAmount:'100 XRP → 2 SOL',feeCents:0,assetKey:'XRP'}]});
if(url.pathname==='/api/admin/kyc'){state.queries.push(url.search);return response({items:[{id:'kyc-fixture',userName:'Example Investor',email:'investor@example.test',status:url.searchParams.get('status')==='PENDING'?'PENDING':'APPROVED',submittedAt:now,reviewedAt:now,version:5}],total:26,page:Number(url.searchParams.get('page')??1),totalPages:2});}
if(url.pathname==='/api/admin/kyc/kyc-fixture'&&method==='PATCH'){state.reverified=true;return response(record());}
if(url.pathname==='/api/admin/kyc/kyc-fixture')return response(record());
if(url.pathname.endsWith('/history')&&(url.pathname.startsWith('/api/kyc')||url.pathname.startsWith('/api/admin/kyc')))return response({items:[{...record(),id:'revision',event:'APPROVE',consentAt:now,createdAt:now}],nextCursor:null});
if(url.pathname==='/api/admin/reconciliation')return response({items:[{userId:'fixture',name:'Example Investor',email:'investor@example.test',issues:[{code:'CRYPTO_RESERVATIONS',asset:'XRP',expected:'1000000',actual:'0'}]}],checkedAt:now,nextCursor:null});
if(url.pathname==='/api/auth/login')return response({twoFactorRequired:true,challenge:'f'.repeat(64)});
if(url.pathname==='/api/auth/two-factor')return new Response(JSON.stringify({ok:false,error:{message:'The code is incorrect or this sign-in expired. Try a new code or sign in again.'}}),{status:400,headers:{'Content-Type':'application/json'}});
if(method!=='GET'){state.blocked.push(url.pathname);throw Error('Unstubbed mutation blocked');}
return original(input,options);
};
window.ethereum={request:async()=>{throw Error('Wallet actions blocked');}};
})()`;
try{
mkdirSync("scripts/shots",{recursive:true});
await cdp.send("Network.setCookie",{name:"qfs_session",value:cookie,url:base,httpOnly:true},sessionId);
await cdp.send("Network.setCookie",{name:"qfs_locale",value:"en",url:base,httpOnly:true},sessionId);
await cdp.send("Page.addScriptToEvaluateOnNewDocument",{source:injection},sessionId);
await cdp.send("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false},sessionId);
await go("/user/user/dashboard/settings");await wait('document.querySelector("#profile-name")',"account settings");
await check("settings shows profile, password, two-factor and sessions",'document.querySelector(".account-settings").textContent.includes("Active sessions")&&document.querySelector("#profile-email").readOnly');
await evaluate('__account.delay=true');await fill("#profile-name","Updated Investor");await click("Save profile");await wait('__account.release',"pending profile");
await check("profile save has immediate busy feedback and locks controls",'document.querySelector("#profile-name").matches(":disabled")&&document.querySelector(".account-settings").textContent.includes("Saving…")');
await evaluate('__account.release();void 0');await wait('document.querySelector(".account-settings").textContent.includes("Profile saved.")',"profile saved");
await check("profile mutation stays in the fixture",'__account.writes[0].path==="/api/account/profile"&&__account.writes[0].body.name==="Updated Investor"');
await shot("account-settings-desktop");
await fill("#setup-password","ExamplePass94");await click("Set up authenticator");await wait('document.querySelector(".account-setup svg")',"local QR");
await check("authenticator QR is generated locally with manual setup key",'document.querySelector(".account-setup code").textContent==="GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"&&__account.blocked.length===0');
await fill("#enable-password","ExamplePass94");await fill("#enable-code","123456");await click("Enable two-factor authentication");await wait('document.querySelector(".account-recovery code")',"recovery codes");
await check("enrollment shows one-time recovery codes and clears setup secret",'document.querySelectorAll(".account-recovery code").length===2&&!document.querySelector(".account-setup")');
await cdp.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);await shot("account-settings-mobile");await check("settings fits mobile viewport",'document.documentElement.scrollWidth<=390');
await go("/user/user/dashboard/statements");await wait('document.querySelector(".account-statement-table")',"statements");
await check("statements separates crypto swaps and exposes complete-period exports",'document.querySelector(".account-statements").textContent.includes("100 XRP → 2 SOL")&&[...document.querySelectorAll("a")].some(link=>link.href.includes("format=csv"))');
await shot("account-statements-mobile");await check("statement page fits mobile with a scrolling table",'document.documentElement.scrollWidth<=390');
await go("/admin/security");await wait('document.querySelector("#profile-name")',"admin security");await check("admin has its own working security page",'document.querySelector(".adm-page-head").textContent.includes("Account security")');
await go("/admin/kyc");await wait('document.querySelector(".adm-pagination")',"KYC queue");await click("Next →");await wait('__account.queries.some(query=>query.includes("page=2"))',"server pagination");
await check("KYC pagination requests the next server page",'__account.queries.some(query=>query.includes("page=2"))');
await evaluate('(()=>{const input=document.querySelector("select[aria-label=\\"Verification status filter\\"]");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(input,"APPROVED");input.dispatchEvent(new Event("change",{bubbles:true}));})()');
await wait('__account.queries.some(query=>query.includes("status=APPROVED")&&query.includes("page=1"))',"server filter");await click("View review");await wait('document.querySelector(".account-kyc-history details")',"history");
await check("review includes preserved verification history",'document.querySelector(".account-kyc-history").textContent.includes("Identity approved")');
await shot("kyc-review-mobile");await click("Request reverification","summary");await fill(".adm-modal textarea","Please upload a renewed document.");await click("Request reverification","button");await wait('__account.reverified',"reverification fixture");
await check("reverification sends the reviewed version and reason",'__account.writes.some(write=>write.path==="/api/admin/kyc/kyc-fixture"&&write.body.action==="REVERIFY"&&write.body.version===5&&write.body.note.length>3)');
await go("/admin/reconciliation");await wait('document.querySelector(".adm-table")',"reconciliation");await check("reconciliation displays discrepancies without financial writes",'document.querySelector(".adm-table").textContent.includes("1 discrepancies")&&__account.writes.length===0');
await cdp.send("Network.deleteCookies",{name:"qfs_session",url:base},sessionId);await go("/admin/login");await wait('(()=>{const form=document.querySelector(".auth-form");return form&&Object.keys(form).some(key=>key.startsWith("__reactProps$")&&typeof form[key]?.onSubmit==="function");})()',"hydrated login");
await check("login uses POST before hydration to keep credentials out of URLs",'document.querySelector(".auth-form").method==="post"');
await fill("#admin-email","investor@example.test");await fill("#admin-password","ExamplePass94");await click("Sign In");await wait('document.querySelector("#login-factor")',"factor challenge");
await check("login waits for second factor and clears the password field",'!document.querySelector("#admin-password")&&document.querySelector(".auth-form").textContent.includes("Verify and sign in")');
await fill("#login-factor","123456");await click("Verify and sign in");await wait('document.querySelector(".auth-form-error")',"factor rejection");await check("invalid second factor shows actionable feedback",'document.querySelector(".auth-form-error").textContent.includes("incorrect")&&__account.writes[1].path==="/api/auth/two-factor"');await shot("admin-factor-login-mobile");
console.log(JSON.stringify({passed:results.length,checks:results}));
}finally{
try{await cdp.send("Network.clearBrowserCookies",{},sessionId);}catch{}
await close();
php(`Illuminate\\Support\\Facades\\DB::table('Session')->where('tokenHash',App\\Support\\SessionAuth::tokenHash('${cookie}'))->delete();`);
}
process.exit(0);
