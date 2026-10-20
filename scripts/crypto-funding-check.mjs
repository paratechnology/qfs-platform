/* Isolated browser regression checks. Every financial write and wallet RPC is a fixture. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, loginCookie, sleep } from "./lib/cdp.mjs";

const base = process.env.BASE_URL ?? "http://localhost:3000";
assert(process.env.QFS_CHECK_SESSION_TOKEN || (process.env.QFS_CHECK_EMAIL && process.env.QFS_CHECK_PASSWORD), "Set a temporary check session or browser check account credentials");
const cookie = process.env.QFS_CHECK_SESSION_TOKEN ?? await loginCookie(base, process.env.QFS_CHECK_EMAIL, process.env.QFS_CHECK_PASSWORD);
const overviewReply = await fetch(`${base}/api/dashboard/overview`, {headers:{Cookie:`qfs_session=${cookie}`}});
const overview = (await overviewReply.json()).data;
assert(overview, "Account overview loads");
overview.accrual.items = [];
overview.balance = {...overview.balance, availableCents:200000, available:"$2,000.00"};
overview.notifications={unread:1,items:[{id:"navigation-notification",title:"Deposit submitted",body:"Your deposit request is awaiting review.",read:false,time:"Just now"}]};
const assets = {
  XRP:{symbol:"XRP",name:"XRP",network:"XRP Ledger",chain:"xrpl",decimals:6,chainId:null,token:null,explorer:"https://livenet.xrpl.org/transactions/"},
  SOL:{symbol:"SOL",name:"Solana",network:"Solana",chain:"solana",decimals:9,chainId:null,token:null,explorer:"https://solscan.io/tx/"},
  BTC:{symbol:"BTC",name:"Bitcoin",network:"Bitcoin",chain:"bitcoin",decimals:8,chainId:null,token:null,explorer:"https://mempool.space/tx/"},
  ETH:{symbol:"ETH",name:"Ethereum",network:"Ethereum",chain:"ethereum",decimals:18,chainId:1,token:null,explorer:"https://etherscan.io/tx/"},
  USDT_TRC20:{symbol:"USDT",name:"Tether",network:"Tron (TRC20)",chain:"tron",decimals:6,chainId:null,token:null,explorer:"https://tronscan.org/#/transaction/"},
  USDT_BEP20:{symbol:"USDT",name:"Tether",network:"BNB Smart Chain (BEP20)",chain:"bsc",decimals:18,chainId:56,token:"0x55d398326f99059fF775485246999027B3197955",explorer:"https://bscscan.com/tx/"},
};
const fixture = {
  usd:{available:"$2,000.00",availableCents:200000,total:"$2,000.00"},totalUsd:"$4,100.00",availableUsd:"$4,100.00",valuationComplete:true,
  holdings:Object.entries(assets).map(([key,asset])=>({assetKey:key,...asset,quantity:key==="ETH"?"1":key==="USDT_BEP20"?"100":"0",available:key==="ETH"?"1":key==="USDT_BEP20"?"100":"0",reserved:"0",availableAtomic:key==="ETH"?"1000000000000000000":key==="USDT_BEP20"?"100000000000000000000":"0",usd:key==="ETH"?"$2,000.00":key==="USDT_BEP20"?"$100.00":"$0.00",priceUsd:key==="ETH"?"2000":"1",priceAt:new Date().toISOString()})),
  wallets:[{id:"eth-treasury",assetKey:"ETH",label:"Ethereum treasury",address:"0x"+"1".repeat(40),isActive:true},{id:"bsc-treasury",assetKey:"USDT_BEP20",label:"BSC treasury",address:"0x"+"3".repeat(40),isActive:true}],requests:[],
};
fixture.holdings.forEach(asset => { asset.availableUsd = asset.usd; });
const injection = `(() => {
 const original=window.fetch.bind(window); const overview=${JSON.stringify(overview)}; const assets=${JSON.stringify(assets)}; const funds=${JSON.stringify(fixture)};
 const units=(quantity,decimals)=>{const [whole,fraction=""]=quantity.split(".");return BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,"0"));};
 const state=window.__fundingCheck={funds,quotes:[],posts:[],walletCalls:[],blocked:[],chain:1,cancel:true,quote:0,adminWallets:[...funds.wallets]};
 if(new URLSearchParams(location.search).has("portfolio-test")){
  funds.usd={available:"$35,000.00",availableCents:3500000,total:"$45,000.00"};
  overview.balance={...overview.balance,availableCents:3500000,available:"$35,000.00"};
  funds.availableUsd="$70,000.00";funds.totalUsd="$80,000.00";
  const holdings={ETH:["1","$2,000.00"],USDT_TRC20:["13000","$13,000.00"],USDT_BEP20:["20000","$20,000.00"]};
  funds.holdings.forEach(asset=>{const [quantity,value]=holdings[asset.assetKey]??["0","$0.00"];asset.quantity=asset.available=quantity;asset.availableAtomic=units(quantity,asset.decimals).toString();asset.usd=asset.availableUsd=value;});
 }
 if(new URLSearchParams(location.search).has("withdrawal-test")){
  funds.usd={available:"$0.00",availableCents:0,total:"$0.00"};
  funds.totalUsd="$200.00";funds.availableUsd="$133.12";
  funds.holdings.forEach(asset=>{const funded=asset.assetKey==="USDT_TRC20";asset.quantity=funded?"200":"0";asset.available=funded?"133.123456":"0";asset.availableAtomic=funded?"133123456":"0";asset.reserved=funded?"66.876544":"0";asset.usd=funded?"$200.00":"$0.00";asset.availableUsd=funded?"$133.12":"$0.00";});
 }
 const ok=data=>new Response(JSON.stringify({ok:true,data}),{headers:{"Content-Type":"application/json"}});
 window.ethereum={request:async({method,params})=>{state.walletCalls.push({method,params});
  if(method==="eth_requestAccounts"||method==="eth_accounts")return ["0x"+"2".repeat(40)];
  if(method==="eth_chainId")return "0x"+state.chain.toString(16);
  if(method==="wallet_switchEthereumChain"){state.chain=parseInt(params[0].chainId,16);return null;}
  if(method==="eth_sendTransaction"){if(state.cancel){state.cancel=false;throw {code:4001,message:"Cancelled"};}if(state.sendUncertain){state.sendUncertain=false;throw {code:-32603,message:"Temporary wallet transport failure"};}return "0x"+(state.chain===1?"a":"b").repeat(64);}
  throw Error("Unsupported fixture wallet request");}};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==="string"?input:input.url,location.origin); if(!url.pathname.startsWith("/api/"))return original(input,options);
  const method=options.method??"GET"; const body=typeof options.body==="string"?JSON.parse(options.body):{};
  if(method!=="GET")state.posts.push({path:url.pathname,method,body});
  await new Promise(resolve=>setTimeout(resolve,400));
  if(state.failPrice&&method==="POST"&&url.pathname==="/api/wallet/quotes")return new Response(JSON.stringify({ok:false,error:{code:"PRICE_UNAVAILABLE",message:"A fresh crypto price is unavailable. Please try again shortly."}}),{status:503,headers:{"Content-Type":"application/json"}});
  if(state.failBalance&&method==="POST"&&["/api/wallet/quotes","/api/investments"].includes(url.pathname))return new Response(JSON.stringify({ok:false,error:{code:"INSUFFICIENT_FUNDS",message:"Insufficient available balance for this transaction"}}),{status:400,headers:{"Content-Type":"application/json"}});
  if(url.pathname==="/api/wallet/funds")return ok(funds);
  if(url.pathname==="/api/wallet")return ok({wallets:[]});
  if(url.pathname==="/api/wallet/swaps")return ok({available:false,assets:[],items:[]});
  if(url.pathname==="/api/dashboard/overview")return ok(overview);
  if(url.pathname==="/api/notifications"&&method==="POST"){overview.notifications.unread=0;overview.notifications.items.forEach(item=>item.read=true);return ok({updated:true});}
  if(url.pathname==="/api/deposits"&&method==="POST")return ok({request:{id:"bank-deposit-fixture"},created:true});
  if(url.pathname==="/api/wallet/deposits"&&method==="POST"){
   const wallet=funds.wallets.find(item=>item.id===body.walletId);const asset=assets[wallet.assetKey];
   const req={id:"deposit-"+funds.requests.length,type:"DEPOSIT",reference:body.reference,status:"PENDING",assetKey:wallet.assetKey,...asset,quantity:body.quantity,quantityAtomic:(BigInt(body.quantity.replace(".",""))*10n**BigInt(asset.decimals-(body.quantity.split(".")[1]?.length??0))).toString(),receivingAddress:wallet.address,txHash:null,explorerUrl:null,fundingSource:"CRYPTO"};
   funds.requests.unshift(req);return ok({request:req});}
  if(url.pathname.startsWith("/api/wallet/deposits/")&&method==="PATCH"){const req=funds.requests.find(item=>item.id===url.pathname.split("/").pop());req.txHash=body.txHash.trim()||null;req.explorerUrl=req.txHash?req.explorer+req.txHash:null;return ok({submitted:true});}
  if(url.pathname==="/api/wallet/quotes"){const quote={id:"quote-"+(++state.quote),assetKey:body.assetKey,...assets[body.assetKey],quantity:body.quantity??String(body.amount/2000),amountCents:Math.round((body.amount??Number(body.quantity)*2000)*100),amount:"$"+(body.amount??Number(body.quantity)*2000).toFixed(2),rateUsd:"2000",expiresAt:new Date(Date.now()+90000).toISOString(),purpose:body.purpose};state.quotes.push(quote);return ok(quote);}
  if(url.pathname==="/api/wallet/withdrawals"&&method==="POST"){
   if(state.expireWithdrawal){state.expireWithdrawal=false;return new Response(JSON.stringify({ok:false,error:{code:"QUOTE_EXPIRED",message:"This quote is unavailable or expired. Request a new quote."}}),{status:409,headers:{"Content-Type":"application/json"}});}
   const existing=funds.requests.find(request=>request.reference===body.reference);if(existing)return ok({request:existing});
   const quote=state.quotes.find(quote=>quote.id===body.quoteId),asset=funds.holdings.find(asset=>asset.assetKey===quote.assetKey);
   const quantityAtomic=units(quote.quantity,asset.decimals);
   if(quote.purpose==="CRYPTO_WITHDRAWAL"){
    asset.availableAtomic=(BigInt(asset.availableAtomic)-quantityAtomic).toString();
    const format=value=>{const raw=value.toString().padStart(asset.decimals+1,"0");return (raw.slice(0,-asset.decimals)+"."+raw.slice(-asset.decimals)).replace(/0+$/,"").replace(/[.]$/,"");};
    asset.available=format(BigInt(asset.availableAtomic));asset.reserved=format(units(asset.reserved,asset.decimals)+quantityAtomic);
   }
   const request={id:"withdrawal-fixture",type:"WITHDRAWAL",status:"PENDING",reference:body.reference,assetKey:quote.assetKey,...assets[quote.assetKey],quantity:quote.quantity,quantityAtomic:quantityAtomic.toString(),receivingAddress:body.address,txHash:null,fundingSource:quote.purpose==="USD_WITHDRAWAL"?"USD":"CRYPTO"};funds.requests.unshift(request);return ok({request});}
  if(url.pathname==="/api/investments"&&method==="POST"){overview.accrual.items=[{id:"investment-fixture",plan:"QFS Starter",payoutInterval:"HOURLY",monthlyRate:"10.00%",principal:"$1,000.00",monthlyProfit:"$100.00",pending:"$0.0000",paid:"$0.00",startedAt:new Date().toISOString(),endsAt:new Date(Date.now()+90*86400000).toISOString(),termMonths:3,status:"ACTIVE",principalRelease:"MANUAL"}];return ok({investment:{id:"investment-fixture"},created:true});}
  if(url.pathname==="/api/investments"||url.pathname==="/api/transactions"||url.pathname==="/api/withdrawals")return ok({items:[],nextCursor:null});
  if(url.pathname==="/api/admin/settings")return ok({site_name:"QFS"});
  if(url.pathname==="/api/admin/receiving-wallets"){
   if(method==="POST"){const wallet={id:"added-fixture",...body,isActive:true};state.adminWallets.push(wallet);return ok(wallet);}
   return ok({assets,wallets:state.adminWallets});}
  if(url.pathname.startsWith("/api/admin/receiving-wallets/")&&method==="PATCH"){
   if(state.failWalletSave&&body.address)return new Response(JSON.stringify({ok:false,error:{code:"ADDRESS",message:"Enter a valid receiving address for the selected network."}}),{status:400,headers:{"Content-Type":"application/json"}});
   const wallet=state.adminWallets.find(item=>item.id===url.pathname.split("/").pop());Object.assign(wallet,body);return ok(wallet);}
  if(method!=="GET"){state.blocked.push(url.pathname);return new Response(JSON.stringify({ok:false,error:{message:"Unstubbed write blocked"}}),{status:400,headers:{"Content-Type":"application/json"}});}
  return original(input,options);
 };
})();`;

const {cdp,sessionId,close}=await launch({port:9238});
const errors=[];
cdp.on("Runtime.exceptionThrown",event=>errors.push(event.exceptionDetails.exception?.description??event.exceptionDetails.text));
const evaluate=async expression=>{const response=await cdp.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},sessionId);if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);return response.result.value;};
async function wait(expression,label){for(let i=0;i<300;i++){if(await evaluate(expression))return;await sleep(150);}throw Error(`Timed out: ${label}`);}
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const clickText=(selector,text)=>evaluate(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error("Button not found");el.click();})()`);
const fill=(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value").set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));})()`);
let count=0;
async function check(label,expression){assert(await evaluate(expression),label);console.log(`PASS ${label}`);count++;}
async function closeDialog(){await wait('document.querySelector(".dash-modal-close")&&!document.querySelector(".dash-modal-close").disabled',"dialog ready to close");await click(".dash-modal-close");await wait('!document.querySelector(".dash-modal")',"dialog closed");}
async function shot(name){const image=await cdp.send("Page.captureScreenshot",{format:"png"},sessionId);writeFileSync(`scripts/shots/${name}.png`,Buffer.from(image.data,"base64"));}
try {
 mkdirSync("scripts/shots",{recursive:true});
 await cdp.send("Network.setCookie",{name:"qfs_session",value:cookie,url:base,httpOnly:true},sessionId);
 await cdp.send("Network.setCookie",{name:"qfs_locale",value:"en",url:base,httpOnly:true},sessionId);
 await cdp.send("Page.addScriptToEvaluateOnNewDocument",{source:injection},sessionId);
 await cdp.send("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false},sessionId);
 if (!process.env.QFS_WALLETS_ONLY) {
 if (!process.env.QFS_WITHDRAWAL_ONLY) {
 await cdp.send("Page.navigate",{url:base+"/user/user/dashboard"},sessionId);
 await wait('document.querySelector(".fund-total")?.textContent==="$4,100.00"',"portfolio");
 await check("Portfolio shows quantities, networks and combined USD value",'document.querySelectorAll(".fund-asset-row").length===3 && document.querySelector(".fund-assets").textContent.includes("BNB Smart Chain")');
 await click('[aria-label="Notifications"].dash-icon-btn');await wait('!!document.querySelector(".dash-notif-list")',"notifications");
 await check("Notifications have a back arrow and an explicit dashboard return",'!!document.querySelector(".dash-modal-back")&&document.querySelector(".dash-modal-navigation button").textContent==="Back to dashboard"');
 await click(".dash-modal-back");await check("The notification back arrow returns to the underlying account view",'!document.querySelector(".dash-modal")&&location.pathname==="/user/user/dashboard"');
 await click('[aria-label="Notifications"].dash-icon-btn');await wait('!!document.querySelector(".dash-notif-list")',"notifications reopened");
 await clickText(".dash-modal-body button","Mark all as read");await sleep(60);
 await check("Notification navigation stays locked while a status update is saving",'document.querySelector(".dash-modal-back").disabled&&document.querySelector(".dash-modal-navigation button").disabled');
 await wait('!document.querySelector(".dash-modal-back").disabled&&!document.querySelector(".dash-modal-body button")',"notifications read");
 await clickText(".dash-modal-navigation button","Back to dashboard");await check("Reading notifications does not trap the user in the dialog",'!document.querySelector(".dash-modal")');
 await shot("crypto-portfolio-desktop");
 await click(".fund-actions .primary");
 await wait('!!document.querySelector("#crypto-quantity")',"deposit form");
 await fill("#crypto-quantity","0.5");
 await clickText(".fund-form button","Get deposit instructions");
 await sleep(60);
 await check("Deposit creation gives immediate progress and prevents dismissal",'!!document.querySelector(".fund-form .dash-spinner")&&document.querySelector(".dash-modal-close").disabled&&document.querySelector(".dash-modal-back").disabled&&document.querySelector(".dash-modal-navigation button").disabled');
 await wait('!!document.querySelector(".fund-qr img")',"local QR generation");
 await check("Deposit instructions preserve exact destination and quantity",'document.querySelector(".fund-address code").textContent==="0x"+"1".repeat(40) && document.querySelector(".fund-transfer-heading").textContent.includes("0.5 ETH")');
 await check("Deposit instructions put their step-back control above the QR code",'document.querySelector(".fund-step-back").textContent==="Back to deposits"&&document.querySelector(".fund-step-back").getBoundingClientRect().top<document.querySelector(".fund-qr").getBoundingClientRect().top');
 await check("QR code is larger, high contrast and rendered at whole pixels per module", '(()=>{const s=document.querySelector(".fund-qr img"),b=s.getBoundingClientRect();return b.width>196&&Number.isInteger(b.width/Number(s.dataset.modules))&&s.complete&&s.naturalWidth>=700&&getComputedStyle(s).colorScheme.includes("only");})()');
 await cdp.send("Emulation.setDeviceMetricsOverride",{width:320,height:740,deviceScaleFactor:1,mobile:true},sessionId);
 await sleep(500);
 await check("QR remains within a small mobile screen with whole-pixel modules", '(()=>{const s=document.querySelector(".fund-qr img"),b=s.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&Number.isInteger(b.width/Number(s.dataset.modules));})()');
 await evaluate('document.querySelector(".dash-modal").scrollTop=100000');
 await check("Small-screen deposits keep a visible dashboard exit and back arrow",'(()=>{const back=document.querySelector(".dash-modal-back").getBoundingClientRect(),exit=document.querySelector(".dash-modal-navigation button").getBoundingClientRect();return back.top>=0&&back.bottom<=innerHeight&&exit.top>=0&&exit.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth;})()');
 await evaluate('document.querySelector(".fund-qr").scrollIntoView({block:"center"})');
 await sleep(300);await shot("crypto-qr-mobile");
 await evaluate('(()=>{const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download==="deposit-qr.png"){window.__qrDownload={url:this.href,name:this.download};return;}return original.call(this);};})()');
 await clickText(".fund-qr-block button","Download QR code");
 await check("QR download saves the same high-resolution PNG displayed on screen", '(()=>{const image=document.querySelector(".fund-qr img");return window.__qrDownload.name==="deposit-qr.png"&&window.__qrDownload.url===image.src&&image.src.startsWith("data:image/png;")&&image.naturalWidth>=700;})()');
 await cdp.send("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false},sessionId);
 await wait('[...document.querySelectorAll(".fund-form button")].some(button=>button.textContent==="Pay with connected wallet"&&!button.disabled)',"wallet payment ready");
 await clickText(".fund-form button","Pay with connected wallet");
 await wait('document.querySelector(".fund-error")?.textContent.includes("cancelled")',"wallet cancellation");
 await check("Cancelled wallet payment never submits a transfer",'window.__fundingCheck.posts.filter(item=>item.method==="PATCH").length===0');
 await clickText(".fund-form button","Pay with connected wallet");
 await wait('!!document.querySelector(".fund-confirmation")',"deposit review state");
 await check("Native wallet payment uses the saved recipient and exact atomic amount",'(()=>{const calls=window.__fundingCheck.walletCalls.filter(item=>item.method==="eth_sendTransaction");const sent=calls.at(-1).params[0];return sent.to==="0x"+"1".repeat(40)&&BigInt(sent.value)===500000000000000000n;})()');
 await check("A sent payment is attached once and does not immediately credit the balance",'window.__fundingCheck.posts.filter(item=>item.method==="PATCH").length===1 && !document.querySelector(".fund-form").textContent.includes("Pay with connected wallet")');
 await shot("crypto-deposit-review");
 await closeDialog();
 await click(".fund-actions .primary");
 await wait('!!document.querySelector("#crypto-wallet")',"second deposit");
 await fill("#crypto-wallet","bsc-treasury");
 await fill("#crypto-quantity","1.25");
 await clickText(".fund-form button","Get deposit instructions");
 await wait('!!document.querySelector(".fund-qr img")',"token instructions");
 await wait('[...document.querySelectorAll(".fund-form button")].some(button=>button.textContent==="Pay with connected wallet"&&!button.disabled)',"token payment ready");
 await clickText(".fund-form button","Pay with connected wallet");
 await wait('!!document.querySelector(".fund-confirmation")',"token deposit submitted");
 await check("Token payment switches network and transfers only the specified amount",'(()=>{const s=window.__fundingCheck;const call=s.walletCalls.filter(item=>item.method==="eth_sendTransaction").at(-1).params[0];return s.chain===56&&call.to.toLowerCase()==="0x55d398326f99059ff775485246999027b3197955"&&call.data.startsWith("0xa9059cbb")&&BigInt("0x"+call.data.slice(-64))===1250000000000000000n&&!call.data.startsWith("0x095ea7b3");})()');
 await closeDialog();
 await click(".fund-actions .primary");
 await wait('!!document.querySelector("#crypto-quantity")',"interrupted payment form");
 await fill("#crypto-quantity","0.3");
 await clickText(".fund-form button","Get deposit instructions");
 await wait('[...document.querySelectorAll(".fund-form button")].some(button=>button.textContent==="Pay with connected wallet"&&!button.disabled)',"interrupted payment ready");
 await evaluate('window.__fundingCheck.sendUncertain=true');
 await clickText(".fund-form button","Pay with connected wallet");
 await wait('!!document.querySelector(".fund-error") && !document.querySelector(".dash-modal-close").disabled',"interrupted wallet response");
 await closeDialog();
 await click(".fund-actions .primary");
 await wait('!!document.querySelector(".fund-resume")',"resume interrupted payment");
 await click(".fund-resume");
 await check("Interrupted payments retain a warning instead of offering another transfer",'document.querySelector(".fund-form").textContent.includes("Check your wallet before sending again") && ![...document.querySelectorAll(".fund-form button")].some(button=>button.textContent==="Pay with connected wallet")');
 await fill("#crypto-txhash","0x"+"c".repeat(64));
 await clickText(".fund-form button","Submit transfer for review");
 await wait('!!document.querySelector(".fund-confirmation")',"manual transfer reference saved");
 await check("Manual transfer submission shares the deposit review flow",'window.__fundingCheck.posts.filter(item=>item.path.startsWith("/api/wallet/deposits/")&&item.method==="PATCH").length===3');
 await closeDialog();
 await click(".fund-actions .primary");
 await wait('!!document.querySelector("#crypto-quantity")',"deposit without hash");
 await fill("#crypto-quantity","0.1");
 await clickText(".fund-form button","Get deposit instructions");
 await wait('!!document.querySelector("#crypto-txhash")&&!document.querySelector(".dash-modal-close").disabled',"optional hash field");
 await check("Deposit submission remains enabled without a hash", 'document.querySelector("#crypto-txhash").value===""&&[...document.querySelectorAll(".fund-form button")].some(b=>b.textContent==="Submit transfer for review"&&!b.disabled)');
 await clickText(".fund-form button","Submit transfer for review");
 await wait('!!document.querySelector(".fund-confirmation")',"hashless deposit saved");
 await check("A hashless deposit saves as pending review without a wallet send", 'window.__fundingCheck.posts.at(-1).body.txHash===""&&document.querySelector(".fund-confirmation").textContent.includes("Pending review")');
 await closeDialog();
 await click(".fund-actions .primary");
 await wait('!!document.querySelector(".fund-resume")',"resume saved hashless deposit");
 await click(".fund-resume");
 await check("Reopening a submitted hashless deposit preserves confirmation instead of offering another payment", '!!document.querySelector(".fund-confirmation")&&!document.querySelector("#crypto-txhash")');
 await clickText(".fund-form button","Back to deposits");await wait('!!document.querySelector("#crypto-quantity")',"back to deposit choices");
 await check("Back to deposits keeps the saved request available to resume",'!!document.querySelector(".fund-resume")&&window.__fundingCheck.funds.requests.some(item=>item.txHash===null&&item.status==="PENDING")');
 await click(".fund-resume");await wait('!!document.querySelector(".fund-confirmation")',"saved deposit confirmation");
 await clickText(".dash-modal-navigation button","Back to dashboard");await check("A submitted crypto deposit has a working dashboard return",'!document.querySelector(".dash-modal")');
 await click(".fund-actions .primary");await wait('!!document.querySelector("#crypto-quantity")',"bank deposit entry");
 await clickText(".fund-tabs button","Bank Transfer");await fill("#dep-amount","500");await clickText(".dash-modal-body button","Submit Deposit Request");
 await wait('!!document.querySelector(".dash-payto-success")&&!document.querySelector(".dash-modal-back").disabled',"bank deposit submitted");
 await check("Bank deposit confirmation retains the back arrow and dashboard return",'!!document.querySelector(".dash-modal-back")&&!document.querySelector(".dash-modal-navigation button").disabled');
 await clickText(".dash-modal-navigation button","Back to dashboard");await wait('!document.querySelector(".dash-modal")',"bank deposit exit");
 await cdp.send("Page.navigate",{url:base+"/user/user/dashboard/transactions"},sessionId);await wait('!!document.querySelector(".dash-page-back")&&document.querySelector(".dash-sb-balance-amount")?.textContent==="$4,100.00"',"account page return link");
 await check("Account subpages expose a dashboard link with a back arrow",'document.querySelector(".dash-page-back").getAttribute("href")==="/user/user/dashboard"&&!!document.querySelector(".dash-page-back svg")');
 await click('[aria-label="Notifications"].dash-icon-btn');await wait('!!document.querySelector(".dash-notif-list")',"notifications from account subpage");
 await click(".dash-modal-back");await check("Dialog Back preserves the account subpage it came from",'!document.querySelector(".dash-modal")&&location.pathname.endsWith("/transactions")');
 await click(".dash-page-back");await wait('location.pathname==="/user/user/dashboard"&&!!document.querySelector(".fund-actions")',"dashboard from subpage");
 await check("The account-page return link reaches the dashboard directly",'!document.querySelector(".dash-workspace")');
 await click('.dash-sb-nav a[href="/user/user/dashboard/investments"]');
 await wait('!!document.querySelector(".dash-page-header .dash-btn")',"investment page");
 await click(".dash-page-header .dash-btn");
 await wait('!!document.querySelector("#inv-from")',"investment form");
 await fill("#inv-from","ETH");
 await click(".dash-modal-body .dash-form-group:nth-child(2) button");
 await fill("#inv-amount","1000");
 await clickText(".dash-modal-body > button","Review USD conversion");
 await wait('!!document.querySelector(".fund-quote")',"investment conversion quote");
 await check("Investment confirmation shows USD principal and exact crypto commitment",'document.querySelector(".fund-quote").textContent.includes("0.5 ETH")&&document.querySelector(".fund-quote").textContent.includes("$1000.00")');
 const sendsBefore=await evaluate('window.__fundingCheck.walletCalls.filter(item=>item.method==="eth_sendTransaction").length');
 await evaluate('window.__fundingCheck.failBalance=true');
 await clickText(".dash-modal-body > button","Confirm USD investment");
 await wait('!!document.querySelector(".dash-form-error")&&!document.querySelector(".dash-modal-close").disabled',"insufficient investment balance");
 await clickText(".dash-transaction-actions button","Fund Account");
 await wait('!!document.querySelector("#crypto-wallet")',"funding from investment");
 await clickText(".dash-transaction-actions button","Back to transaction");
 await check("Investment funding detour preserves the entered amount and conversion review",'document.querySelector("#inv-amount").value==="1000"&&!!document.querySelector(".fund-quote")&&document.querySelector("#inv-from").value==="ETH"');
 await evaluate('window.__fundingCheck.failBalance=false');
 await clickText(".dash-modal-body > button","Confirm USD investment");
 await wait('!document.querySelector(".dash-modal")',"investment completed");
 await check("Investment commits platform funds without a wallet transaction",`window.__fundingCheck.walletCalls.filter(item=>item.method==="eth_sendTransaction").length===${sendsBefore} && window.__fundingCheck.posts.some(item=>item.path==="/api/investments"&&item.body.quoteId)`);
 await cdp.send("Page.navigate",{url:base+"/user/user/dashboard"},sessionId);
 await wait('document.querySelector(".fund-total")?.textContent==="$4,100.00" && !!window.__fundingCheck',"withdrawal dashboard");
 await click(".fund-actions .ghost");
 await wait('!!document.querySelector("#withdraw-source")',"withdrawal form");
 await fill("#withdraw-source","CRYPTO");
 await fill("#withdraw-quantity","0.2");
 await fill("#withdraw-address","0x"+"2".repeat(40));
 await cdp.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
 await evaluate('window.__fundingCheck.failBalance=true');
 await clickText(".fund-form button","Review withdrawal");
 await wait('document.querySelector(".fund-error")?.textContent.includes("Insufficient")&&!document.querySelector(".dash-modal-close").disabled',"insufficient withdrawal balance");
 await evaluate('document.querySelector(".dash-modal").scrollTop=100000');
 await check("Failed transaction keeps close, cancel and funding actions visible on mobile",'(()=>{const close=document.querySelector(".dash-modal-close").getBoundingClientRect(),actions=document.querySelector(".dash-transaction-actions").getBoundingClientRect();return close.top>=0&&close.bottom<=innerHeight&&actions.top>=0&&actions.bottom<=innerHeight&&[...document.querySelectorAll(".dash-transaction-actions button")].map(button=>button.textContent.trim()).join(",")==="Cancel,Fund Account";})()');
 await shot("insufficient-balance-actions-mobile");
 await clickText(".dash-transaction-actions button","Cancel");
 await check("Cancel exits the failed transaction",'!document.querySelector(".dash-modal")');
 await click(".fund-actions .ghost");
 await wait('!!document.querySelector("#withdraw-source")',"withdrawal reopened");
 await fill("#withdraw-source","CRYPTO");await fill("#withdraw-quantity","0.2");await fill("#withdraw-address","0x"+"2".repeat(40));
 await clickText(".fund-form button","Review withdrawal");
 await wait('!!document.querySelector(".fund-error")&&!document.querySelector(".dash-modal-close").disabled',"insufficient balance retry");
 await clickText(".dash-transaction-actions button","Fund Account");
 await wait('!!document.querySelector("#crypto-quantity")',"direct funding flow");
 await check("Fund Account opens deposit instructions without resubmitting the failed transaction",'!document.querySelector("#withdraw-quantity").getClientRects().length&&document.querySelector(".dash-transaction-actions").textContent.includes("after your deposit is confirmed")');
 await fill("#crypto-quantity","0.1");
 await clickText(".fund-form button","Get deposit instructions");
 await sleep(60);
 await check("Funding controls stay locked while deposit preparation is pending",'[...document.querySelectorAll(".dash-transaction-actions button")].every(button=>button.disabled)&&document.querySelector(".dash-modal-close").disabled');
 await wait('!!document.querySelector(".fund-qr img")&&!document.querySelector(".dash-modal-close").disabled',"funding instructions ready");
 await shot("fund-account-return-mobile");
 await clickText(".dash-transaction-actions button","Back to transaction");
 await check("Returning from funding retains the withdrawal amount, asset and destination",'document.querySelector("#withdraw-quantity").value==="0.2"&&document.querySelector("#withdraw-source").value==="CRYPTO"&&document.querySelector("#withdraw-address").value==="0x"+"2".repeat(40)&&document.querySelector("#withdraw-quantity").getClientRects().length>0');
 await evaluate('window.__fundingCheck.failBalance=false');
 await clickText(".fund-form button","Review withdrawal");
 await wait('!!document.querySelector(".fund-quote")',"withdrawal quote");
 await clickText(".fund-form button","Confirm withdrawal");
 await wait('document.querySelector(".fund-confirmation")?.textContent.includes("Withdrawal submitted")',"withdrawal reserved");
 await check("Withdrawal uses a server quote and gives a persistent reservation confirmation",'window.__fundingCheck.posts.filter(item=>item.path==="/api/wallet/withdrawals").length===1');
 await closeDialog();
 await cdp.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
 await check("Asset ledger fits a mobile viewport",'document.documentElement.scrollWidth<=390');
 await shot("crypto-portfolio-mobile");
 }
 await cdp.send("Page.navigate",{url:base+"/user/user/dashboard?portfolio-test=1"},sessionId);
 await wait('document.querySelector(".fund-total")?.textContent==="$70,000.00"',"combined available portfolio");
 await check("Dashboard and sidebar include USD, ETH and both USDT networks in available balance",'document.querySelector(".dash-sb-balance-amount").textContent==="$70,000.00"&&document.querySelector(".fund-asset-row .fund-asset-value strong").textContent==="$35,000.00"');
 await check("Invested capital is included only in the secondary portfolio total",'document.querySelector(".fund-portfolio-total").textContent.includes("$80,000.00")&&document.querySelector("#funds-heading").textContent==="Available balance"');
 await check("Crypto holdings keep distinct networks, quantities and USD values",'document.querySelectorAll(".fund-asset-row").length===4&&document.querySelector("[data-asset-key=ETH]").textContent.includes("1 ETH")&&document.querySelector("[data-asset-key=USDT_TRC20]").textContent.includes("$13,000.00")&&document.querySelector("[data-asset-key=USDT_BEP20]").textContent.includes("$20,000.00")');
 await evaluate('(()=>{const funds=window.__fundingCheck.funds;funds.availableUsd="$66,500.00";const balances={ETH:["0.75","0.25","750000000000000000","$1,500.00"],USDT_TRC20:["12000","1000","12000000000","$12,000.00"],USDT_BEP20:["18000","2000","18000000000000000000000","$18,000.00"]};for(const asset of funds.holdings){const value=balances[asset.assetKey];if(value)[asset.available,asset.reserved,asset.availableAtomic,asset.availableUsd]=value;}window.dispatchEvent(new Event("focus"));})()');
 await wait('document.querySelector(".fund-total")?.textContent==="$66,500.00"',"reserved funds excluded");
 await check("Refreshing reservations updates the headline, sidebar and each available holding",'document.querySelector(".dash-sb-balance-amount").textContent==="$66,500.00"&&document.querySelector("[data-asset-key=ETH] .fund-asset-value strong").textContent==="0.75 ETH"&&document.querySelector("[data-asset-key=ETH] .fund-asset-value").textContent.includes("$1,500.00")&&document.querySelector("[data-asset-key=USDT_TRC20]").textContent.includes("Reserved: 1000 USDT")');
 await cdp.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);await sleep(350);
 await check("The combined balance and network breakdown fit a mobile viewport",'document.documentElement.scrollWidth<=390');await shot("available-balance-mobile");
 await evaluate('window.__fundingCheck.funds.availableUsd=null;window.__fundingCheck.funds.totalUsd=null;window.__fundingCheck.funds.valuationComplete=false;window.__fundingCheck.funds.holdings.find(asset=>asset.assetKey==="ETH").availableUsd=null;window.dispatchEvent(new Event("focus"));');
 await wait('document.querySelector(".fund-total")?.textContent==="—"',"unavailable combined valuation");
 await check("A missing crypto valuation never presents USD cash alone as the combined balance",'document.querySelector(".dash-sb-balance-amount").textContent==="—"&&document.querySelector(".fund-asset-row .fund-asset-value strong").textContent==="$35,000.00"&&document.querySelector("[data-asset-key=ETH] .fund-asset-value strong").textContent==="0.75 ETH"&&document.querySelector("[data-asset-key=ETH] .fund-asset-value").textContent.includes("Price unavailable")');
 await cdp.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
 await cdp.send("Page.navigate",{url:base+"/user/user/dashboard?withdrawal-test=1"},sessionId);
 await wait('!!window.__fundingCheck && document.querySelector(".fund-total")?.textContent==="$133.12"',"crypto-only withdrawal account");
 await click(".fund-actions .ghost");await wait('!!document.querySelector("#withdraw-source")',"crypto-only form");
 await check("A normal withdrawal form has no unrelated static footer",'!document.querySelector(".dash-transaction-actions")');
 await check("Withdrawals default to funded Tron USDT instead of an empty USD or Ethereum balance",'document.querySelector("#withdraw-source").value==="CRYPTO"&&document.querySelector("#withdraw-asset").value==="USDT_TRC20"&&document.querySelector("[data-withdraw-available]").textContent==="133.123456 USDT"');
 await check("The selected balance shows the correct network and excludes reservations",'document.querySelector(".fund-withdraw-balance").textContent.includes("Tron (TRC20)")&&document.querySelector(".fund-withdraw-balance").textContent.includes("66.876544 USDT")');
 await sleep(350);await shot("withdrawal-funded-usdt-mobile");
 await evaluate('(()=>{const amounts={BTC:"0.00123456",ETH:"1.000000000000000001",USDT_TRC20:"133.123456",USDT_BEP20:"25.000000000000000001",XRP:"10.123456",SOL:"2.123456789"};for(const asset of window.__fundingCheck.funds.holdings){asset.available=amounts[asset.assetKey];const parts=asset.available.split(".");asset.availableAtomic=(BigInt(parts[0])*10n**BigInt(asset.decimals)+BigInt((parts[1]||"").padEnd(asset.decimals,"0"))).toString();}})()');
 await evaluate('window.dispatchEvent(new Event("focus"))');await sleep(800);
 for(const [key,quantity] of Object.entries({BTC:"0.00123456",ETH:"1.000000000000000001",USDT_TRC20:"133.123456",USDT_BEP20:"25.000000000000000001",XRP:"10.123456",SOL:"2.123456789"})){
  await fill("#withdraw-asset",key);await clickText(".fund-form button","Use available balance");
  await check(key+" displays its own exact available balance and maximum quantity",`document.querySelector('[data-withdraw-available]').textContent.startsWith(${JSON.stringify(quantity+' ')})&&document.querySelector('#withdraw-quantity').value===${JSON.stringify(quantity)}&&document.documentElement.scrollWidth<=innerWidth`);
 }
 await fill("#withdraw-asset","USDT_TRC20");await fill("#withdraw-quantity","12.3456");await fill("#withdraw-address","T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb");
 const quotesBeforeAddressError=await evaluate('window.__fundingCheck.posts.filter(item=>item.path==="/api/wallet/quotes").length');
 await fill("#withdraw-address","0x"+"2".repeat(40));await clickText(".fund-form button","Review withdrawal");
 await wait('document.querySelector(".fund-error")?.textContent.includes("beginning with T")',"Tron address guidance");
 await check("Wrong-network address errors do not suggest funding the account",`!document.querySelector('.dash-transaction-actions')&&window.__fundingCheck.posts.filter(item=>item.path==='/api/wallet/quotes').length===${quotesBeforeAddressError}`);
 await fill("#withdraw-address","T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb");await evaluate('window.__fundingCheck.failPrice=true');
 await clickText(".fund-form button","Review withdrawal");await wait('document.querySelector(".fund-error")?.textContent.includes("fresh crypto price")',"price unavailable");
 await check("Price outages keep the withdrawal editable and show no funding footer",'!document.querySelector(".dash-transaction-actions")&&!document.querySelector("#withdraw-quantity").disabled');
 await evaluate('window.__fundingCheck.failPrice=false');
 await clickText(".fund-form button","Review withdrawal");await wait('!!document.querySelector(".fund-quote")',"Tron withdrawal quote");
 await check("Reviewing a quote keeps unrelated footer actions hidden",'!document.querySelector(".dash-transaction-actions")');
 await check("Crypto review submits the selected asset and exact quantity instead of charging USD",'window.__fundingCheck.posts.filter(item=>item.path==="/api/wallet/quotes").at(-1).body.purpose==="CRYPTO_WITHDRAWAL"&&window.__fundingCheck.posts.filter(item=>item.path==="/api/wallet/quotes").at(-1).body.assetKey==="USDT_TRC20"&&window.__fundingCheck.posts.filter(item=>item.path==="/api/wallet/quotes").at(-1).body.quantity==="12.3456"');
 await evaluate('window.__fundingCheck.expireWithdrawal=true');await clickText(".fund-form button","Confirm withdrawal");
 await wait('!!document.querySelector(".fund-error")&&!document.querySelector(".fund-quote")',"expired quote reset");
 await check("An expired quote unlocks the form and preserves withdrawal details",'!document.querySelector("#withdraw-quantity").disabled&&document.querySelector("#withdraw-quantity").value==="12.3456"&&document.querySelector("#withdraw-address").value==="T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"');
 await clickText(".fund-form button","Review withdrawal");await wait('!!document.querySelector(".fund-quote")',"refreshed withdrawal quote");
 await evaluate('[...document.querySelectorAll(".fund-form button")].find(button=>button.textContent==="Confirm withdrawal").click();[...document.querySelectorAll(".fund-form button")].find(button=>button.textContent==="Confirm withdrawal").click();');
 await wait('document.querySelector(".fund-confirmation")?.textContent.includes("Withdrawal submitted")',"Tron withdrawal saved");
 await check("Crypto withdrawal succeeds once, displays its reference and refreshes the reserved balance",'window.__fundingCheck.posts.filter(item=>item.path==="/api/wallet/withdrawals").length===2&&window.__fundingCheck.funds.holdings.find(asset=>asset.assetKey==="USDT_TRC20").available==="120.777856"&&document.querySelector(".fund-confirmation").textContent.includes("WD-")');
 await wait('document.querySelector(".dash-transaction-actions")?.textContent.trim()==="Done"',"withdrawal completion action");
 await check("A submitted withdrawal offers Done without Cancel or Fund Account",'document.querySelectorAll(".dash-transaction-actions button").length===1&&document.querySelector(".dash-transaction-actions button").textContent==="Done"');
 await sleep(350);await shot("withdrawal-submitted-usdt-mobile");await clickText(".dash-transaction-actions button","Done");
 await check("Done closes the completed withdrawal",'!document.querySelector(".dash-modal")');
 await clickText(".fund-actions button","Swap");await wait('document.querySelector(".swap-form")?.textContent.includes("not available yet")',"unavailable swap view");
 await check("Unavailable swaps have no unrelated funding footer",'!document.querySelector(".dash-transaction-actions")');
 await closeDialog();
 }
 await cdp.send("Page.navigate",{url:base+"/admin/settings"},sessionId);
 await wait('!!document.querySelector(".adm-receiving-row")',"admin receiving wallets");
 await clickText(".adm-wallet-heading button","Add receiving wallet");
 await wait('!!document.querySelector(".adm-modal")',"wallet editor");
 await evaluate('(()=>{const fields=document.querySelectorAll(".adm-modal input");for(const [i,value] of ["Secondary treasury","0x"+"4".repeat(40)].entries()){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(fields[i],value);fields[i].dispatchEvent(new Event("input",{bubbles:true}));}})()');
 await clickText(".adm-modal button","Add receiving wallet");
 await wait('!document.querySelector(".adm-modal")&&document.querySelectorAll("[aria-labelledby=receiving-wallets-title] .adm-receiving-row").length===3',"wallet saved");
 await check("Admin wallet creation reaches the configured-wallet API",'window.__fundingCheck.posts.some(item=>item.path==="/api/admin/receiving-wallets"&&item.body.address==="0x"+"4".repeat(40))');
 await check("Every receiving wallet has Edit beside Enable or Disable",'document.querySelectorAll(".adm-wallet-row").length===3&&[...document.querySelectorAll(".adm-wallet-actions")].every(row=>row.querySelectorAll("button").length===2&&row.querySelector("button").textContent==="Edit")');
 await click('[data-wallet-id="eth-treasury"] .adm-wallet-actions button');await wait('!!document.querySelector(".adm-modal")',"edit receiving wallet");
 await check("Edit opens the selected wallet with its details prefilled and network preserved",`document.querySelector('.adm-modal h3').textContent==='Edit receiving wallet'&&document.querySelector('.adm-modal input[aria-label="Wallet label"]').value==='Ethereum treasury'&&document.querySelector('.adm-modal input[aria-label="Receiving address"]').value==='0x'+'1'.repeat(40)&&document.querySelector('.adm-modal select').disabled`);
 const writesBeforeCancel=await evaluate('window.__fundingCheck.posts.length');
 await fill('.adm-modal input[aria-label="Wallet label"]',"Discarded change");await clickText(".adm-modal button","Cancel");
 await check("Cancel leaves the receiving wallet unchanged without writing",`!document.querySelector('.adm-modal')&&document.querySelector('[data-wallet-id="eth-treasury"] strong').textContent==='Ethereum treasury'&&window.__fundingCheck.posts.length===${writesBeforeCancel}`);
 await click('[data-wallet-id="eth-treasury"] .adm-wallet-actions button');await wait('!!document.querySelector(".adm-modal")',"wallet reopened");
 await fill('.adm-modal input[aria-label="Receiving address"]',"invalid-address");await evaluate('window.__fundingCheck.failWalletSave=true');await clickText(".adm-modal button","Save Changes");
 await wait('!!document.querySelector(".adm-modal .adm-banner.error")',"wallet validation error");
 await check("Invalid wallet edits show a recoverable error inside the editor",`document.querySelector('.adm-modal input[aria-label="Receiving address"]').value==='invalid-address'&&document.querySelector('.adm-modal .adm-banner.error').textContent.includes('selected network')&&!document.querySelector('.adm-modal-close').disabled`);
 await evaluate('window.__fundingCheck.failWalletSave=false');
 await fill('.adm-modal input[aria-label="Receiving address"]',"0x"+"5".repeat(40));await fill('.adm-modal input[aria-label="Wallet label"]',"Updated treasury");
 const writesBeforeSave=await evaluate('window.__fundingCheck.posts.length');
 await evaluate('(()=>{const button=[...document.querySelectorAll(".adm-modal button")].find(button=>button.textContent==="Save Changes");button.click();button.click();})()');await sleep(60);
 await check("Saving a wallet shows progress and prevents repeat submissions or dismissal",`document.querySelector('.adm-modal').getAttribute('aria-busy')==='true'&&document.querySelector('.adm-modal-close').disabled&&!!document.querySelector('.adm-modal .action-spinner')&&window.__fundingCheck.posts.length===${writesBeforeSave+1}`);
 await wait('!document.querySelector(".adm-modal")&&document.querySelector("[data-wallet-id=eth-treasury] strong").textContent==="Updated treasury"',"wallet edit saved");
 await check("Wallet changes update the original row instead of creating another wallet",'document.querySelectorAll(".adm-wallet-row").length===3&&document.querySelector("[data-wallet-id=eth-treasury] code").textContent==="0x"+"5".repeat(40)&&window.__fundingCheck.posts.at(-1).method==="PATCH"&&window.__fundingCheck.posts.at(-1).body.assetKey===undefined');
 await clickText('[data-wallet-id="eth-treasury"] .adm-wallet-actions button',"Disable");
 await wait('document.querySelector("[data-wallet-id=eth-treasury] .adm-wallet-actions").textContent.includes("Enable")',"wallet disabled");
 await click('[data-wallet-id="eth-treasury"] .adm-wallet-actions button');await wait('!!document.querySelector(".adm-modal")',"edit disabled wallet");
 await fill('.adm-modal input[aria-label="Wallet label"]',"Edited while disabled");await clickText(".adm-modal button","Save Changes");
 await wait('!document.querySelector(".adm-modal")&&document.querySelector("[data-wallet-id=eth-treasury] strong").textContent==="Edited while disabled"',"disabled wallet updated");
 await check("Editing a disabled wallet preserves its disabled state",'!window.__fundingCheck.adminWallets.find(wallet=>wallet.id==="eth-treasury").isActive&&document.querySelector("[data-wallet-id=eth-treasury] .adm-wallet-actions").textContent.includes("Enable")');
 await clickText('[data-wallet-id="eth-treasury"] .adm-wallet-actions button',"Enable");
 await wait('document.querySelector("[data-wallet-id=eth-treasury] .adm-wallet-actions").textContent.includes("Disable")',"wallet reenabled");
 await check("Enable and Disable continue to work after an address edit",'window.__fundingCheck.adminWallets.find(wallet=>wallet.id==="eth-treasury").isActive&&document.querySelector("[data-wallet-id=eth-treasury] code").textContent==="0x"+"5".repeat(40)');
 await evaluate('window.__fundingCheck.adminWallets.push({id:"xrp-fixture",assetKey:"XRP",label:"XRP treasury",address:"rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",destinationTag:"123",isActive:true});window.dispatchEvent(new Event("focus"));');
 await wait('!!document.querySelector("[data-wallet-id=xrp-fixture]")',"XRP wallet");await click('[data-wallet-id="xrp-fixture"] .adm-wallet-actions button');
 await wait(`!!document.querySelector('.adm-modal input[aria-label="XRP destination tag"]')`,"XRP tag editor");
 await check("XRP wallet editing prefills the destination tag",`document.querySelector('.adm-modal input[aria-label="XRP destination tag"]').value==='123'`);
 await fill('.adm-modal input[aria-label="XRP destination tag"]',"");await clickText(".adm-modal button","Save Changes");await wait('!document.querySelector(".adm-modal")',"XRP tag cleared");
 await check("An optional XRP destination tag can be cleared",'window.__fundingCheck.posts.at(-1).body.destinationTag===null&&window.__fundingCheck.adminWallets.find(wallet=>wallet.id==="xrp-fixture").destinationTag===null');
 await cdp.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);await sleep(350);
 await check("Wallet edit and activation controls fit on a mobile screen",'document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll(".adm-wallet-actions")].every(row=>{const rect=row.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth;})');
 await shot("crypto-admin-wallets-mobile");
 await check("All financial browser writes remained fixtures",'window.__fundingCheck.blocked.length===0');
 assert.deepEqual(errors,[],"No runtime exceptions");
 console.log(`${count} crypto funding browser checks passed`);
} catch(error) { await shot("crypto-check-failure").catch(()=>{}); throw error; } finally { await close(); }
