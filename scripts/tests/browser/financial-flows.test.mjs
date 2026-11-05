import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {webcrypto, createHash} from "node:crypto";

const funds = () => ({usd:{availableCents:0,available:"$0.00"},holdings:[
  {assetKey:"ETH",symbol:"ETH",network:"Ethereum",available:"2",availableAtomic:"2000000000000000000"},
  {assetKey:"SOL",symbol:"SOL",network:"Solana",available:"10",availableAtomic:"10000000000"},
],wallets:[],requests:[]});
function app(handler, {locale="en",storage=new Map()}={}) {
  const factories={}, calls=[], events=[], listeners=new Map();
  const location={origin:"http://127.0.0.1:8091",hostname:"127.0.0.1",search:"",assign(path){events.push({type:"navigate",detail:path});}};
  const document={documentElement:{lang:locale},body:{style:{overflow:""}},querySelector:()=>null,hidden:false,addEventListener(name,fn){if(name==="alpine:init")fn();}};
  const window={location,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},dispatchEvent(event){events.push(event);for(const fn of listeners.get(event.type)||[])fn(event);},__QFS_TX:source=>source};
  const context={console,document,window,location,Intl,Date,BigInt,TextEncoder,Uint8Array,URL,URLSearchParams,FormData,Blob,crypto:webcrypto,navigator:{},Alpine:{data:(name,factory)=>factories[name]=(...args)=>Object.assign(factory(...args),{$nextTick:async fn=>fn?.()})},
    setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},queueMicrotask:fn=>fn(),
    CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail;}},
    sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},localStorage:{getItem:()=>null,setItem(){}},
    fetch:async(path,options={})=>{let body=options.body instanceof FormData?options.body:options.body?JSON.parse(options.body):undefined;const call={path,method:options.method||"GET",body,headers:options.headers};calls.push(call);const result=await handler(call);const status=result?.status||200;return {ok:status>=200&&status<300,status,json:async()=>result?.error?{ok:false,error:result.error}:{ok:true,data:result?.data??result}};}};
  vm.createContext(context);
  for(const file of ["dash-money.js","dash-crypto.js","dashboard.js","dash-forms.js","dash-views.js","admin.js"]){vm.runInContext(readFileSync(new URL("../../public/js/"+file,import.meta.url),"utf8"),context,{filename:file});}
  return {factories,calls,events,context,storage};
}
const quote = asset => ({id:"quote-1",assetKey:asset,symbol:asset,amount:"$500.00",amountCents:50000,quantity:"0.25",expiresAt:new Date(Date.now()+60000).toISOString()});

test("invest directly from deposited crypto without an intermediate swap",async()=>{
  const a=app(call=>call.path==="/api/wallet/funds"?funds():call.path==="/api/wallet/quotes"?quote(call.body.assetKey):{investment:{id:"investment-1"}});
  const form=a.factories.investForm({defaultPlanId:"plan"});await form.init();assert.equal(form.source,"ETH");form.amount="500";
  await form.submit();assert.equal(form.done,false);const q=a.calls.find(c=>c.path==="/api/wallet/quotes");assert.deepEqual(q.body,{purpose:"INVESTMENT",assetKey:"ETH",amount:500});
  await form.submit();assert.equal(form.done,true);const request=a.calls.find(c=>c.path==="/api/investments");assert.equal(request.body.quoteId,"quote-1");assert.equal(request.body.amount,500);assert.match(request.body.reference,/^INV-/);assert.equal(a.calls.some(c=>c.path.includes("/swaps")),false);assert(a.events.some(e=>e.type==="dash-funds-refresh"));form.destroy();
});

test("USD investments use the same confirmation without a crypto quote",async()=>{
  const snapshot=funds();snapshot.usd={availableCents:100000,available:"$1,000.00"};
  const a=app(call=>call.path==="/api/wallet/funds"?snapshot:{investment:{id:"usd"}});const f=a.factories.investForm({defaultPlanId:"plan"});await f.init();f.amount="500";await f.submit();await f.submit();assert.equal(f.source,"USD");assert.equal(f.done,true);assert.equal(a.calls.some(c=>c.path==="/api/wallet/quotes"),false);assert.equal("quoteId" in a.calls.find(c=>c.path==="/api/investments").body,false);
});

test("a lost investment response survives closing/reopening and retries the same request",async()=>{
  const storage=new Map();let body;
  const first=app(c=>{if(c.path==="/api/wallet/funds")return funds();if(c.path==="/api/wallet/quotes")return quote("ETH");body=c.body;throw new TypeError("Connection interrupted");},{storage});
  const f=first.factories.investForm({defaultPlanId:"plan"});await f.init();f.amount="500";await f.submit();await f.submit();assert.equal(f.uncertain,true);assert(storage.has("qfs.invest.attempt"));
  const second=app(c=>c.path==="/api/wallet/funds"?funds():{investment:{id:"already-created"}},{storage});const retry=second.factories.investForm();await retry.init();retry.now=Date.now()+120000;await retry.submit();assert.equal(retry.done,true);assert.deepEqual(second.calls.find(c=>c.path==="/api/investments").body,body);assert.equal(storage.has("qfs.invest.attempt"),false);
});

test("insufficient crypto exposes funding recovery and expired quotes require review",async()=>{
  const a=app(c=>c.path==="/api/wallet/funds"?funds():{status:400,error:{code:"INSUFFICIENT_FUNDS",message:"Not enough crypto"}});const f=a.factories.investForm({defaultPlanId:"plan"});await f.init();f.amount="500";await f.submit();assert.equal(f.needsFunds,true);assert.equal(f.busy,false);assert.equal(f.uncertain,false);
  f.quote=quote("ETH");f.now=Date.now()+120000;await f.submit();assert.equal(f.quote,null);assert.match(f.error,/expired/);
});

test("localized money parsing rejects truncated or ambiguous amounts",()=>{
  const a=app(()=>funds());for(const input of ["1,000","100abc","0","0.001","1e3"]){assert.equal(vm.runInContext(`amountValue(${JSON.stringify(input)}, 'en')`,a.context),null);}
  assert.equal(vm.runInContext("amountValue('100,50', 'de')",a.context),100.5);assert.equal(vm.runInContext("amountValue('١٠٠٫٥٠', 'ar')",a.context),100.5);
});

test("completed swap routes investment and withdrawal to the resulting asset",async()=>{
  const snapshot=funds();snapshot.usd={availableCents:10000,available:"$100.00"};const a=app(()=>snapshot);
  const swap=a.factories.cryptoSwapForm();swap.completedAsset="SOL";swap.useSwappedFunds("invest");const event=a.events.at(-1);assert.equal(event.detail.assetKey,"SOL");
  const investment=a.factories.investForm({defaultPlanId:"plan"});await investment.init();a.factories.dashboard().openModal(event.detail);assert.equal(investment.source,"SOL");
  const withdrawal=a.factories.withdrawFundsForm();await withdrawal.init();a.factories.dashboard().openModal({name:"withdraw",assetKey:"SOL"});assert.equal(withdrawal.assetKey,"SOL");assert.equal(withdrawal.source,"CRYPTO");withdrawal.useMax();assert.equal(withdrawal.wdAmount,"10");
});

test("bank withdrawal retries preserve a reservation reference",async()=>{
  let attempt=0;const a=app(c=>{if(c.method==="GET")return funds();if(attempt++===0)throw new TypeError("Network error");return {request:{id:"withdrawal"}};});const w=a.factories.withdrawFundsForm();await w.init();w.amount="50";w.details="Example account details";await w.submitBank();await w.submitBank();const posts=a.calls.filter(c=>c.path==="/api/withdrawals");assert.equal(posts.length,2);assert.equal(posts[0].body.reference,posts[1].body.reference);assert.equal(w.done,true);
});

test("plan editing preserves documents and publishes a source-bound reviewed translation",async()=>{
  const a=app(c=>c.method==="GET"?[]:{});const config={resource:"plans",mapEdit:r=>({...r,documentIds:JSON.parse(r.documentIds),translations:JSON.parse(r.translations)})};const p=a.factories.admContent(config);p.openEdit({id:"plan",documentIds:'["document-1"]',translations:'{}',description:"English description",terms:"English terms",riskDisclosure:"Risk"});p.translationDraft={description:"Description française",terms:"Conditions",riskDisclosure:"Risque"};p.translationReviewed=true;await p.applyTranslation();assert.equal(p.form.translations.es.sourceHash,createHash("sha256").update("English description\0English terms\0Risk").digest("hex"));await p.save();const call=a.calls.find(c=>c.method==="PATCH");assert.deepEqual(call.body.documentIds,["document-1"]);assert.equal(call.body.translations.es.terms,"Conditions");
});

test("private PDF upload uses multipart and selecting another document clears the file",async()=>{
  const a=app(c=>c.method==="GET"?[]:{id:"document"});const d=a.factories.admContent({resource:"documents",defaults:{sort:0,isActive:true}});d.openNew();d.form={code:"terms",title:"Agreement",flagPath:"/favicon.ico",sort:0,isActive:true};d.uploadFile=new Blob(["%PDF-1.7\nfixture"],{type:"application/pdf"});await d.save();const call=a.calls.find(c=>c.path==="/api/admin/documents/upload");assert(call.body instanceof FormData);assert.equal(call.body.get("isActive"),"1");assert.equal(call.headers["Content-Type"],undefined);d.uploadFile=new Blob();d.openEdit({id:"another"});assert.equal(d.uploadFile,null);
});

test("review submission reports pending approval and does not submit twice",async()=>{
  const a=app(()=>({data:{submitted:true,status:"PENDING"}}));const form=a.factories.reviewForm();form.text="A helpful account interface.";await form.submit();await form.submit();assert.equal(form.done,true);assert.equal(a.calls.length,1);assert.equal(a.calls[0].path,"/api/reviews");
});

test("card actions call the account-scoped action endpoint",async()=>{
  const a=app(c=>c.method==="GET"?[]:{status:"FROZEN"});const cards=a.factories.cardManager();await cards.act("card-1","FREEZE");assert.equal(a.calls[0].path,"/api/cards/card-1");assert.equal(a.calls[0].method,"PATCH");assert.equal(a.calls[0].body.action,"FREEZE");assert.equal(cards.busy,"");
});

test("admin content editor preserves enabled and disabled database flags",()=>{
  const a=app(()=>[]);const editor=a.factories.admContent({resource:"documents"});
  editor.openEdit({id:"doc",isActive:1});assert.equal(editor.form.isActive,true);
  editor.openEdit({id:"doc",isActive:0});assert.equal(editor.form.isActive,false);
});

test("transaction search opens the selected transaction instead of an unrelated first page",async()=>{
  const a=app(()=>({items:[],nextCursor:null}));a.context.window.location.search="?id=transaction-42";
  const list=a.factories.txList("/api/transactions");await list.init();assert.equal(a.calls[0].path,"/api/transactions?id=transaction-42");
});

test("deposit QR rendering uses opaque colors, a quiet zone and whole-pixel modules",async()=>{
  const a=app(()=>funds());vm.runInContext(readFileSync(new URL("../../public/js/qrcode.bundle.js",import.meta.url),"utf8"),a.context);const real=a.context.QRCode;let options;a.context.QRCode={create:real.create,toCanvas:async(_canvas,_address,config)=>{options=config;}};
  const canvas={style:{},parentElement:{parentElement:{clientWidth:280}}};const deposit=a.factories.depositFundsForm({});deposit.intent={receivingAddress:"THHujXZgw8vhqUD42DkgspTYnZwjEKvBQC"};deposit.$refs={depositQr:canvas};deposit.drawQr();await Promise.resolve();assert(options.width>=800);assert.equal(options.margin,4);assert.equal(options.color.dark,"#000000ff");assert.equal(options.color.light,"#ffffffff");const modules=real.create(deposit.intent.receivingAddress,{errorCorrectionLevel:"M"}).modules.size+8;assert.equal(parseInt(canvas.style.width)%modules,0);assert.equal(options.width%modules,0);
});


test("investment preview uses exact cents and atomic units for USD and XRP input", async()=>{
  const snapshot=funds();snapshot.holdings.push({assetKey:"XRP",symbol:"XRP",network:"XRP Ledger",decimals:6,available:"500",availableAtomic:"500000000",availableUsd:"$1,000.00",priceUsd:"2",priceAt:new Date().toISOString()});
  const a=app(call=>call.path==="/api/wallet/funds"?snapshot:call.path==="/api/wallet/quotes"?{...quote("XRP"),quantity:"500",amountCents:110000,amount:"$1,100.00"}:{investment:{id:"xrp"}});
  const f=a.factories.investForm({defaultPlanId:"plan"});await f.init();f.source="XRP";f.amount="1000";
  assert.equal(f.estimate.quantity,"500");assert.equal(f.estimate.amountCents,100000);assert.equal(f.availableUsd,"$1,000.00");
  f.amountUnit="CRYPTO";f.amount="500.000001";assert.equal(f.exceedsEstimate,true);
  f.amount="500.0000001";assert.equal(f.estimate,null);
  f.amount="500";assert.equal(f.estimate.amountCents,100000);await f.submit();
  assert.deepEqual(a.calls.find(c=>c.path==="/api/wallet/quotes").body,{purpose:"INVESTMENT",assetKey:"XRP",quantity:"500"});
  await f.submit();assert.equal(a.calls.find(c=>c.path==="/api/investments").body.amount,1100);assert.equal(f.done,true);
});

test("investment preview does not display stale or invalid prices",()=>{
  const a=app(()=>funds());const base={decimals:6,priceUsd:"2",priceAt:new Date(Date.now()-121000).toISOString()};
  a.context.previewAsset=base;
  assert.equal(vm.runInContext('investmentEstimate(previewAsset,"500","CRYPTO","en",Date.now())',a.context),null);
  base.priceAt="invalid";
  assert.equal(vm.runInContext('investmentEstimate(previewAsset,"500","CRYPTO","en",Date.now())',a.context),null);
});

test("admin delete action submits confirmation and clears password after success",async()=>{
  const a=app(c=>c.method==="GET"?{items:[],total:0,page:1,totalPages:1}:{deleted:true});const u=a.factories.admUsers();
  u.openDelete({id:"member",name:"Test Member",email:"member@example.test"});
  u.deleteForm={confirmation:"member@example.test",reason:"Remove fixture",currentPassword:"Test-password-01",code:"123456"};
  await u.deleteUser();const call=a.calls.find(c=>c.method==="PATCH");assert.equal(call.body.action,"DELETE");assert.equal(call.body.confirmation,"member@example.test");assert.equal(u.deleting,null);assert.equal(Object.keys(u.deleteForm).length,0);
});


test("bulk adjustment requires a reason and reports applied/skipped accounts",async()=>{
 const a=app(c=>c.method==="GET"?{items:[],total:0,page:1,totalPages:1}:{applied:2,skipped:1});const u=a.factories.admUsers();
 u.openAdjustAll();u.adjAmount="100";await u.submitAdjust();assert.equal(a.calls.length,0);
 u.adjNote="Class project adjustment";await u.submitAdjust();const post=a.calls.find(c=>c.method==="POST");assert.equal(post.body.scope,"ALL");assert.equal("userId" in post.body,false);assert.match(u.toast,/2 accounts adjusted; 1 skipped/);
});


test("sidebar follows combined crypto/USD funds updates and modal scrolling is restored",async()=>{
 const a=app(()=>({...funds(),availableUsd:"$38,000.00",valuationComplete:true}));const d=a.factories.dashboard();d.init();await d.refreshFunds();assert.equal(d.portfolioAvailable,"$38,000.00");
 a.context.window.dispatchEvent(new a.context.CustomEvent("dash-funds-updated",{detail:{availableUsd:"$37,000.00",valuationComplete:true}}));assert.equal(d.portfolioAvailable,"$37,000.00");
 d.openModal("invest");assert.equal(a.context.document.body.style.overflow,"hidden");d.closeModal();assert.equal(a.context.document.body.style.overflow,"");d.destroy();
});
