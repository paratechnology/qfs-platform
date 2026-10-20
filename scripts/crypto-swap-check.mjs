/* Browser swap checks: all financial mutations and wallet RPC are isolated fixtures. */
import assert from "node:assert/strict";
import {mkdirSync, writeFileSync} from "node:fs";
import {launch, loginCookie, sleep} from "./lib/cdp.mjs";

const base = process.env.BASE_URL ?? "http://localhost:3000";
assert(process.env.QFS_CHECK_EMAIL && process.env.QFS_CHECK_PASSWORD, "Set browser check credentials");
const cookie = await loginCookie(base, process.env.QFS_CHECK_EMAIL, process.env.QFS_CHECK_PASSWORD);
const overview = (await (await fetch(base + "/api/dashboard/overview", {headers:{Cookie:"qfs_session=" + cookie}})).json()).data;
assert(overview, "Overview loads");
overview.balance.availableCents = 200000; overview.balance.available = "$2,000.00";
const injection = `(() => {
 const overview = ${JSON.stringify(overview)};
 const assets = {
  XRP:{symbol:"XRP",name:"XRP",network:"XRP Ledger",chain:"xrpl",decimals:6,chainId:null,token:null,explorer:"https://livenet.xrpl.org/transactions/"},
  SOL:{symbol:"SOL",name:"Solana",network:"Solana",chain:"solana",decimals:9,chainId:null,token:null,explorer:"https://solscan.io/tx/"}
 };
 const wallets=[{id:"xrp-wallet",assetKey:"XRP",label:"XRP treasury",address:"rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",destinationTag:"123",isActive:true},
 {id:"sol-wallet",assetKey:"SOL",label:"SOL treasury",address:"So11111111111111111111111111111111111111112",destinationTag:null,isActive:true}];
 const state=window.__swap={writes:[],swaps:[],available:true,blocked:[],rpc:0,routes:[],quotes:0,requests:[],};
 window.ethereum={request:async()=>{state.rpc++;throw Error("Wallet RPC is blocked during swap checks");}};
 const response=data=>new Response(JSON.stringify({ok:true,data}),{status:200,headers:{"Content-Type":"application/json"}});
 const funds=()=>({usd:{available:"$2,000.00",availableCents:200000,total:"$2,000.00"},totalUsd:"$3,000.00",availableUsd:"$3,000.00",valuationComplete:true,
  holdings:Object.entries(assets).map(([assetKey,asset])=>({...asset,assetKey,quantity:assetKey==="XRP"?"500":"0",available:assetKey==="XRP"?"500":"0",reserved:"0",availableAtomic:assetKey==="XRP"?"500000000":"0",usd:assetKey==="XRP"?"$1,000.00":"$0.00",availableUsd:"$1,000.00",priceUsd:"2",priceAt:new Date().toISOString()})),wallets,requests:state.requests});
 const original=window.fetch.bind(window);
 window.fetch=async(input,opts={})=>{
  const url=new URL(typeof input==="string"?input:input.url,location.origin),method=opts.method??"GET",body=opts.body?JSON.parse(opts.body):null;
  if(url.origin!==location.origin){state.blocked.push(url.href);throw Error("External request blocked");}
  if(method!=="GET")state.writes.push({path:url.pathname,method,body});
  if(url.pathname==="/api/dashboard/overview")return response(overview);
  if(url.pathname==="/api/wallet/funds")return response(funds());
  if(url.pathname==="/api/wallet/swaps"&&method==="GET")return response({available:state.available,assets:Object.keys(assets).map(assetKey=>({assetKey,from:true,to:true})),items:state.swaps});
  if(url.pathname==="/api/wallet/swaps/quote"){await new Promise(r=>state.releaseQuote=r);state.releaseQuote=null;state.quotes++;return response({id:"quote-"+state.quotes,fromAsset:body.fromAsset,toAsset:body.toAsset,quantity:body.quantity,receiveQuantity:"2.000000001",networkFee:"0.001",expiresAt:new Date(Date.now()+45000).toISOString()});}
  if(url.pathname==="/api/wallet/swaps"&&method==="POST"){await new Promise(r=>setTimeout(r,250));const old=state.swaps.find(s=>s.reference===body.reference);if(old)return response(old);
   const swap={id:"swap-"+(state.swaps.length+1),reference:body.reference,status:state.forceCancelled?"CANCELLED":"PROCESSING",fromAsset:"XRP",toAsset:"SOL",fromSymbol:"XRP",toSymbol:"SOL",fromNetwork:"XRP Ledger",toNetwork:"Solana",quantity:"100",quotedQuantity:"2.000000001",receivedQuantity:null,payoutUrl:null,createdAt:new Date().toISOString(),completedAt:null};state.swaps.unshift(swap);if(state.dropNext){state.dropNext=false;throw TypeError("Failed to fetch");}return response(swap);}
  if(url.pathname==="/api/wallet/deposits"){const request={id:"deposit-xrp",reference:body.reference,status:"PENDING",assetKey:"XRP",quantity:body.quantity,quantityAtomic:"1000000",symbol:"XRP",network:"XRP Ledger",receivingAddress:wallets[0].address,destinationTag:"123",fundingSource:"CRYPTO",txHash:null,explorerUrl:null,type:"DEPOSIT"};state.requests.push(request);return response({request});}
  if(url.pathname==="/api/admin/swaps/configuration"){
   if(method==="PUT"){state.routes=[body];return response({saved:true});}
   return response({enabled:false,credentialsConfigured:false,providerAvailable:false,automaticFunding:false,assets,wallets,routes:state.routes,currencies:[]});}
  if(url.pathname==="/api/admin/swaps")return response({automaticFunding:false,items:[{...state.swaps[0],id:"admin-swap",reference:"SWAP-fixture",quantity:"100",quotedQuantity:"2.000000001",fromSymbol:"XRP",toSymbol:"SOL",fromNetwork:"XRP Ledger",toNetwork:"Solana",fromAsset:"XRP",toAsset:"SOL",createdAt:new Date().toISOString(),status:state.adminStatus??"AWAITING_FUNDING",userName:"Fixture",userEmail:"fixture@example.test",providerId:"provider-fixture",providerStatus:"waiting",payinAddress:wallets[0].address,payinTag:"987",payTill:new Date(Date.now()+600000).toISOString(),fundingAttemptAt:state.adminStatus?new Date().toISOString():null,payinHash:null,lastError:null,routing:{from:{address:wallets[0].address,tag:"123"},to:{address:wallets[1].address,tag:null}}}]});
  if(url.pathname==="/api/admin/swaps/admin-swap"){state.adminStatus=body.action==="BEGIN_FUNDING"?"FUNDING":"PROCESSING";return response({status:state.adminStatus,fundingAttemptAt:new Date().toISOString(),payinHash:body.txHash});}
  if(url.pathname==="/api/admin/settings")return response({site_name:"QFS"});
  if(url.pathname==="/api/admin/receiving-wallets")return response({assets,wallets});
  if(method!=="GET"){state.blocked.push(url.pathname);return new Response(JSON.stringify({ok:false,error:{message:"Unstubbed mutation blocked"}}),{status:400,headers:{"Content-Type":"application/json"}});}
  return original(input,opts);
 };
})();`;
const {cdp,sessionId,close}=await launch({port:9241});
const errors=[];
cdp.on("Runtime.exceptionThrown",e=>errors.push(e.exceptionDetails.exception?.description??e.exceptionDetails.text));
const evaluate=async expression=>{const r=await cdp.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
async function wait(expression,label){for(let i=0;i<250;i++){if(await evaluate(`Boolean(${expression})`))return;await sleep(160);}throw Error("Timed out: "+label);}
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const clickText=(selector,text)=>evaluate(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error("Missing button "+${JSON.stringify(text)});el.click();})()`);
const fill=(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value").set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));})()`);
let passed=0;
async function check(label,expression){assert(await evaluate(expression),label);console.log("PASS "+label);passed++;}
async function shot(name){const r=await cdp.send("Page.captureScreenshot",{format:"png"},sessionId);writeFileSync("scripts/shots/"+name+".png",Buffer.from(r.data,"base64"));}
try{
 mkdirSync("scripts/shots",{recursive:true});
 await cdp.send("Network.setCookie",{name:"qfs_session",value:cookie,url:base,httpOnly:true},sessionId);
 await cdp.send("Network.setCookie",{name:"qfs_locale",value:"en",url:base,httpOnly:true},sessionId);
 await cdp.send("Page.addScriptToEvaluateOnNewDocument",{source:injection},sessionId);
 await cdp.send("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false},sessionId);
 await cdp.send("Page.navigate",{url:base+"/user/user/dashboard"},sessionId);
 await wait('document.querySelector(".fund-panel")?.textContent.includes("500 XRP")',"funds");
 await clickText(".fund-actions button","Swap");
 await wait('document.querySelector("#swap-quantity")',"swap form");
 await check("swap shows available source quantity and both networks",'document.querySelector(".swap-form").textContent.includes("500 XRP")&&document.querySelector("#swap-to").textContent.includes("Solana")');
 await fill("#swap-quantity","100");
 await clickText(".swap-form button","Review swap");
 await wait('document.querySelector(".swap-form .dash-spinner")',"quote loading");
 await check("quote request gives loading feedback and locks dismissal",'document.querySelector(".dash-modal-close").disabled');
 await evaluate('__swap.releaseQuote(); void 0');
 await wait('document.querySelector(".swap-quote")',"quote");
 await check("quote displays net output and network fee",'document.querySelector(".swap-quote").textContent.includes("2.000000001 SOL")&&document.querySelector(".swap-quote").textContent.includes("0.001 SOL")');
 await shot("swap-quote-desktop");
 await evaluate('__swap.dropNext=true');
 await clickText(".swap-form button","Confirm swap");
 await wait('document.querySelector(".swap-form .fund-error")',"interrupted confirmation");
 await check("interrupted confirmation offers an idempotent retry",'document.querySelector(".swap-form").textContent.includes("Check swap request")');
 await clickText(".swap-form button","Check swap request");
 await wait('document.querySelector(".swap-history")',"swap history");
 await check("confirmation retry creates one order with one reference",'__swap.swaps.length===1&&new Set(__swap.writes.filter(w=>w.path==="/api/wallet/swaps").map(w=>w.body.reference)).size===1&&document.querySelector(".swap-form").textContent.includes("reserved")');
 await check("swap does not call the connected wallet",'__swap.rpc===0');
 await cdp.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
 await shot("swap-history-mobile");
 await check("mobile swap fits the viewport",'document.documentElement.scrollWidth<=390');
 await clickText(".swap-form button","Swap again");
 await fill("#swap-quantity","100");
 await clickText(".swap-form button","Review swap");
 await wait('typeof __swap.releaseQuote==="function"',"second quote request");
 await evaluate('__swap.releaseQuote(); void 0');
 await wait('document.querySelector(".swap-quote")',"second quote");
 await evaluate('__swap.forceCancelled=true');
 await clickText(".swap-form button","Confirm swap");
 await wait('document.querySelector(".fund-confirmation")?.textContent.includes("Swap cancelled")',"cancelled swap");
 await check("cancelled swaps clearly report available funds",'document.querySelector(".fund-confirmation").textContent.includes("Your crypto remains available")');
 await evaluate('window.__swap.available=false; window.dispatchEvent(new Event("focus"));');
 await wait('document.querySelector(".swap-form").textContent.includes("Crypto swaps are not available yet.")',"provider disabled");
 await check("provider unavailability preserves swap history",'!!document.querySelector(".swap-history")');
 await click(".dash-modal-close");
 await clickText(".fund-actions button","Deposit");
 await wait('document.querySelector("#crypto-quantity")',"deposit");
 await fill("#crypto-quantity","1");
 await clickText(".fund-form button","Get deposit instructions");
 await wait('document.querySelector(".fund-form").textContent.includes("XRP destination tag")',"destination tag");
 await check("XRP deposit instructions retain the destination tag",'document.querySelector(".fund-form").textContent.includes("123")');
 await cdp.send("Page.navigate",{url:base+"/admin/swaps"},sessionId);
 await wait('document.querySelector(".adm-swap-row")',"admin queue");
 await click(".adm-swap-row");
 await wait('document.querySelector(".adm-swap-details")',"admin details");
 await check("admin sees exact funding address and XRP tag",'document.querySelector(".adm-modal").textContent.includes("987")&&document.querySelector(".adm-modal").textContent.includes("100 XRP")');
 await clickText(".adm-modal button","Begin treasury funding");
 await wait('document.querySelector(".adm-modal").textContent.includes("Record funding transaction")',"funding marker");
 await fill(".adm-modal input.adm-input","a".repeat(64));
 await clickText(".adm-modal button","Record funding transaction");
 await wait('document.querySelector(".adm-modal").textContent.includes("Exchanging")',"funding recorded");
 await check("admin funding records a hash without settling user balances",'__swap.writes.filter(w=>w.path==="/api/admin/swaps/admin-swap").map(w=>w.body.action).join(",")==="BEGIN_FUNDING,RECORD_FUNDING"');
 await shot("swap-admin-mobile");
 await cdp.send("Page.navigate",{url:base+"/admin/settings"},sessionId);
 await wait('document.querySelector("#swap-config-title")?.closest("section").textContent.includes("Configure Changelly credentials")',"swap settings");
 await check("missing provider credentials are clearly shown",'document.querySelector("#swap-config-title").closest("section").textContent.includes("Configure Changelly credentials")');
 await check("all supported swap assets have configuration rows",'document.querySelectorAll(".adm-swap-routes .adm-receiving-row").length===2');
 await check("no real mutation or wallet RPC escaped the fixtures",'__swap.blocked.length===0&&__swap.rpc===0');
 assert.deepEqual(errors,[],"No runtime errors");
 console.log(passed+" swap browser checks passed.");
}catch(e){await shot("swap-check-failure");throw e;}finally{await close();}
