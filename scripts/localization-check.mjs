/* Render every new language. Financial writes and wallet RPC are blocked. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {launch,sleep} from "./lib/cdp.mjs";
import {messageKey} from "../lib/i18n/locales.ts";

const base=process.env.BASE_URL??"http://localhost:3000";
const languages=["it","pt","nl","pl","ru","tr","hi","bn","ur","zh-CN","zh-TW","ja","ko","id","vi","th"];
const visualOnly=process.argv.includes("--visual-only");
const php=code=>execFileSync("php",["-r",`require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); if(!app()->environment('local'))throw new RuntimeException('Local checks only'); ${code}`],{cwd:"server",encoding:"utf8"}).trim();
const token=visualOnly?"":php("$id=Illuminate\\Support\\Facades\\DB::table('User')->where('role','ADMIN')->where('status','ACTIVE')->value('id'); if(!$id)throw new RuntimeException('An active admin is required');echo App\\Support\\SessionAuth::issue($id);");
const {cdp,sessionId,close}=await launch({port:9247});
let checks=0;
const evaluate=async expression=>{const r=await cdp.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
async function wait(expression,label){for(let i=0;i<120;i++){if(await evaluate(`!!(${expression})`))return;await sleep(500);}throw Error("Timed out: "+label);}
async function check(label,expression){const valid=await evaluate(expression);if(!valid){await screenshot("locale-failure");console.log(await evaluate('JSON.stringify({url:location.href,lang:document.documentElement.lang,dir:document.documentElement.dir,options:document.querySelector(".language-selector select")?.options.length,text:document.body.innerText.slice(-1600)})'));console.log(expression);}assert(valid,label);checks++;console.log("PASS "+label);}
async function navigate(path,selector){await cdp.send("Page.navigate",{url:base+path},sessionId);await wait(`document.querySelector(${JSON.stringify(selector)})`,path);}
async function screenshot(name){const r=await cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false},sessionId);writeFileSync(`scripts/shots/${name}.png`,Buffer.from(r.data,"base64"));}
const injection=`(()=>{
window.__locale={blocked:[],writes:[]};
const original=window.fetch.bind(window);const response=data=>new Response(JSON.stringify({ok:true,data}),{status:200,headers:{'Content-Type':'application/json'}});
window.fetch=async(input,options={})=>{
const url=new URL(typeof input==='string'?input:input.url,location.origin),method=options.method??'GET';
if(url.origin!==location.origin){__locale.blocked.push(url.href);throw Error('External request blocked');}
if(url.pathname==='/api/account/security')return response({user:{name:'PRIVATE_NAME_94',email:'private@example.test',phone:null,country:'Nigeria',role:'ADMIN'},twoFactorEnabled:false,recoveryCodesRemaining:0,sessions:[{id:'fixture',current:true,ipAddress:'127.0.0.1',userAgent:'Chrome on Windows',createdAt:'2026-10-16T12:00:00Z',lastSeenAt:null,expiresAt:'2026-10-20T12:00:00Z'}]});
if(url.pathname==='/api/kyc')return response({id:'fixture',version:1,status:'DRAFT',details:{},files:[],submittedAt:null,reviewedAt:null,reviewNote:null});
if(url.pathname==='/api/admin/kyc')return response({items:[],total:0,page:1,totalPages:0});
if(method!=='GET'){
 const headers=new Headers(options.headers??{});
 if(headers.has('Next-Action'))return original(input,options);
 __locale.blocked.push(url.pathname);throw Error('Financial/account mutations blocked');
}
return original(input,options);
};window.ethereum={request:async()=>{throw Error('Wallet actions blocked');}};
})()`;
try{
mkdirSync("scripts/shots",{recursive:true});
await cdp.send("Page.addScriptToEvaluateOnNewDocument",{source:injection},sessionId);
await cdp.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
if(visualOnly){
 await cdp.send("Network.setCookie",{name:"qfs_locale",value:"ur",url:base,httpOnly:true},sessionId);
 await cdp.send("Emulation.setScriptExecutionDisabled",{value:true},sessionId);
 await navigate("/user/user/login",".auth-form");await sleep(1000);
 await check("Urdu sign-in is visible before JavaScript runs",'[...document.querySelectorAll(".auth-page .reveal")].every(node=>getComputedStyle(node).opacity==="1")&&document.documentElement.lang==="ur"');
 await screenshot("locale-ur-without-js");
 await cdp.send("Emulation.setScriptExecutionDisabled",{value:false},sessionId);
}
for(const locale of languages){
 const catalog=JSON.parse(readFileSync(`lib/i18n/catalogs/${locale}.json`,"utf8"));const all=Object.assign({},...Object.values(catalog));const text=source=>all[messageKey(source)];
 await cdp.send("Network.deleteCookies",{name:"qfs_session",url:base},sessionId);
 await cdp.send("Network.setCookie",{name:"qfs_locale",value:locale,url:base,httpOnly:true},sessionId);
 await navigate("/user/user/login",".auth-form");await sleep(1100);
 await check(`${locale}: localized sign-in and all language options`, `document.documentElement.lang===${JSON.stringify(locale)}&&document.documentElement.dir===${JSON.stringify(locale==="ur"?"rtl":"ltr")}&&document.querySelector(".language-selector select").options.length===21&&document.querySelector(".auth-card").textContent.includes(${JSON.stringify(text("Log In"))})`);
 await check(`${locale}: sign-in fits mobile`,"document.documentElement.scrollWidth<=390");
 if(visualOnly)await check(`${locale}: login content is visible without internal clipping`, '(()=>{const frame=document.querySelector(".auth-frame").getBoundingClientRect(),card=document.querySelector(".auth-card").getBoundingClientRect();return [...document.querySelectorAll(".auth-page .reveal")].every(node=>getComputedStyle(node).opacity==="1")&&frame.top<844&&card.left>=frame.left&&card.right<=frame.right;})()');
 await screenshot(`locale-${locale}-login`);
 if(visualOnly)continue;
 await navigate("/forgot-password",".auth-form");
 await check(`${locale}: recovery interface is translated`, `document.documentElement.lang===${JSON.stringify(locale)}&&document.querySelector(".auth-card").textContent.includes(${JSON.stringify(text("Send recovery link"))})&&document.documentElement.scrollWidth<=390`);
 await cdp.send("Network.setCookie",{name:"qfs_session",value:token,url:base,httpOnly:true},sessionId);
 await navigate("/user/user/dashboard/settings","#profile-name");
 await check(`${locale}: account settings preserve private values`, `document.documentElement.lang===${JSON.stringify(locale)}&&document.querySelector("#profile-name").value==="PRIVATE_NAME_94"&&document.querySelector(".account-settings").textContent.includes(${JSON.stringify(text("Current password"))})&&document.documentElement.scrollWidth<=390&&__locale.blocked.length===0`);
 if(["pl","ur","bn","ja","th"].includes(locale))await screenshot(`locale-${locale}-settings`);
 await navigate("/admin/kyc",".adm-pagination");
 await check(`${locale}: admin review and account catalogs agree`, `document.documentElement.lang===${JSON.stringify(locale)}&&document.querySelector(".adm-page-head").textContent.includes(${JSON.stringify(text("Identity verification"))})&&document.documentElement.scrollWidth<=390&&__locale.blocked.length===0`);
 if(locale==="ur")await screenshot("locale-ur-admin-kyc");
}
await cdp.send("Network.deleteCookies",{name:"qfs_session",url:base},sessionId);
await cdp.send("Network.setCookie",{name:"qfs_locale",value:"en",url:base,httpOnly:true},sessionId);
await navigate("/user/user/login",".auth-form");
await wait('(()=>{const select=document.querySelector(".language-selector select");return Object.keys(select).some(key=>key.startsWith("__reactProps$")&&typeof select[key]?.onChange==="function");})()',"hydrated language selector");
await evaluate('(()=>{const select=document.querySelector(".language-selector select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(select,"ur");select.dispatchEvent(new Event("change",{bubbles:true}));})()');
await wait('document.documentElement.lang==="ur"',"real Urdu selection");
await check("selector applies Urdu through the real server action",'document.documentElement.dir==="rtl"&&document.querySelector(".language-selector select").value==="ur"');
await navigate("/user/user/login",".auth-form");await check("language selection survives a reload",'document.documentElement.lang==="ur"&&document.documentElement.dir==="rtl"');
console.log(JSON.stringify({passed:checks,languages:languages.length}));
}finally{
try{await cdp.send("Network.clearBrowserCookies",{},sessionId);}catch{}
await close();if(token)php(`Illuminate\\Support\\Facades\\DB::table('Session')->where('tokenHash',App\\Support\\SessionAuth::tokenHash('${token}'))->delete();`);
}
process.exit(0);
