import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,sleep} from './lib/cdp.mjs';

const base=process.env.BASE_URL??'http://localhost:3000';
const php=code=>execFileSync('php',['-r',`require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); if(!app()->environment('local'))throw new RuntimeException('Local checks only'); ${code}`],{cwd:'server',encoding:'utf8'}).trim();
const token=php("$id=Illuminate\\Support\\Facades\\DB::table('User')->where('status','ACTIVE')->value('id');echo App\\Support\\SessionAuth::issue($id);");
let browser;
try{
 const [funds,overview]=await Promise.all(['/api/wallet/funds','/api/dashboard/overview'].map(async path=>{
  const reply=await fetch(base+path,{headers:{Cookie:'qfs_session='+token},signal:AbortSignal.timeout(30000)});const data=await reply.json();assert(reply.ok&&data.ok,path);return data.data;
 }));
 const wallet=funds.wallets.find(w=>w.assetKey==='USDT_TRC20');assert(wallet,'Tron receiving wallet is configured');
 overview.user.name='Preview Member';overview.accrual.items=[];
 const asset=funds.holdings.find(a=>a.assetKey===wallet.assetKey);
 browser=await launch({port:9256});const {cdp,sessionId}=browser;
 const evaluate=async expression=>{const response=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);return response.result.value;};
 async function wait(expression){for(let i=0;i<200;i++){if(await evaluate(`!!(${expression})`))return;await sleep(200);}throw Error('Timed out '+expression);}
 const injection=`(()=>{
 const original=fetch.bind(window),funds=${JSON.stringify({...funds,requests:[]})},overview=${JSON.stringify(overview)},wallet=${JSON.stringify(wallet)},asset=${JSON.stringify(asset)};
 const reply=data=>new Response(JSON.stringify({ok:true,data}),{headers:{'Content-Type':'application/json'}});
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.origin),method=options.method||'GET';
  if(url.pathname==='/api/wallet/funds'){window.__qrReady=true;return reply(funds);}
  if(url.pathname==='/api/dashboard/overview')return reply(overview);
  if(url.pathname==='/api/wallet')return reply({wallets:[]});
  if(url.pathname==='/api/wallet/deposits'&&method==='POST'){
   const body=JSON.parse(options.body);return reply({request:{id:'qr-preview',type:'DEPOSIT',status:'PENDING',reference:'QR preview',assetKey:wallet.assetKey,...asset,quantity:body.quantity,quantityAtomic:'100000000',receivingAddress:wallet.address,txHash:null,fundingSource:'CRYPTO'}});
  }
  if(method!=='GET')throw Error('Real writes blocked in QR preview');
  return original(input,options);
 };
 })()`;
 await cdp.send('Network.setCookie',{name:'qfs_session',value:token,url:base,httpOnly:true},sessionId);
 await cdp.send('Network.setCookie',{name:'qfs_locale',value:'en',url:base},sessionId);
 await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:injection},sessionId);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true},sessionId);
 await cdp.send('Emulation.setAutoDarkModeOverride',{enabled:true},sessionId);
 await cdp.send('Page.navigate',{url:base+'/user/user/dashboard'},sessionId);
 await wait(`window.__qrReady && document.querySelector('.fund-actions .primary')`);
 await sleep(200);
 await evaluate(`document.querySelector('.fund-actions .primary').click()`);
 await wait(`document.querySelector('#crypto-quantity')`);
 await evaluate(`(()=>{const select=document.querySelector('.fund-form select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(wallet.id)});select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await evaluate(`(()=>{const input=document.querySelector('#crypto-quantity');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'100');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await sleep(100);
 await evaluate(`[...document.querySelectorAll('.fund-form button')].find(b=>b.textContent==='Get deposit instructions').click()`);
 await wait(`document.querySelector('.fund-qr img')`);
 await evaluate(`document.querySelector('.dash-modal').scrollTop=0`);await sleep(400);
 await wait(`document.querySelector('.fund-qr img')?.complete`);
 mkdirSync('scripts/shots',{recursive:true});
 async function shot(name){const result=await cdp.send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync('scripts/shots/'+name+'.png',Buffer.from(result.data,'base64'));}
 await cdp.send('Emulation.setAutoDarkModeOverride',{enabled:false},sessionId);await sleep(200);
 await shot('deposit-qr-normal');
 await cdp.send('Emulation.setAutoDarkModeOverride',{enabled:true},sessionId);await sleep(300);
 await shot('deposit-qr-auto-dark');
 const pixels=await evaluate(`(()=>{const image=document.querySelector('.fund-qr img'),canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let black=0,white=0,other=0;for(let i=0;i<data.length;i+=4){if(data[i]===0&&data[i+1]===0&&data[i+2]===0&&data[i+3]===255)black++;else if(data[i]===255&&data[i+1]===255&&data[i+2]===255&&data[i+3]===255)white++;else other++;}return {black,white,other,width:canvas.width};})()`);
 assert(pixels.black>0&&pixels.white>0&&pixels.other===0&&pixels.width>=700,'Opaque high-resolution black/white PNG');
 const details=await evaluate(`(()=>{const image=document.querySelector('.fund-qr img');return {scheme:getComputedStyle(image).colorScheme,modules:+image.dataset.modules,width:image.getBoundingClientRect().width};})()`);
 assert.equal(details.scheme,'light only');assert(Number.isInteger(details.width/details.modules));
 console.log('PASS: black/white PNG, high-resolution source, dark-mode protection and whole-pixel modules');
 console.log(JSON.stringify(await evaluate(`(()=>{const qr=document.querySelector('.fund-qr img'),rect=qr.getBoundingClientRect();return {size:rect.width,viewBox:+qr.dataset.modules,scheme:getComputedStyle(qr).colorScheme,addressMatches:document.querySelector('.fund-address code').textContent===${JSON.stringify(wallet.address)},overflow:document.documentElement.scrollWidth>innerWidth};})()`)));
}finally{
 if(browser)await browser.close();
 php(`Illuminate\\Support\\Facades\\DB::table('Session')->where('tokenHash',hash('sha256',${JSON.stringify(token)}))->delete();`);
}
process.exit(0);
